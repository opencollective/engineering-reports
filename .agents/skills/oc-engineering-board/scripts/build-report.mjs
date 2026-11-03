#!/usr/bin/env node
// Renders an engineering period report from report.json into one self-contained HTML file.
// Usage: node build-report.mjs <report.json> [out.html]   (default: report.html beside the JSON)
// Images referenced by the report are read relative to report.json and inlined as data URIs.

import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, extname, isAbsolute, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ASSETS = join(dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'report');
const BOARD_URL = 'https://github.com/orgs/opencollective/projects/21';

// Engineering Area options, in report order, with the color family each one uses.
export const AREAS = [
  ['Improvements', 'product'],
  ['Payment processors', 'product'],
  ['Support', 'product'],
  ['Bug fixes', 'bugs'],
  ['Security', 'trust'],
  ['Compliance', 'trust'],
  ['Reliability & monitoring', 'reliability'],
  ['Resilience & recovery', 'reliability'],
  ['Platform maintenance', 'foundations'],
  ['Technical debt', 'foundations'],
  ['Testing & CI', 'dx'],
  ['Developer experience', 'dx'],
];
const AREA_FAMILY = new Map(AREAS);
const AREA_ORDER = new Map(AREAS.map(([name], index) => [name, index]));

// Short names for the repositories in the pull request breakdown; others fall back to the repo name.
export const REPO_LABELS = {
  'opencollective/opencollective-api': 'API',
  'opencollective/opencollective-frontend': 'Frontend',
  'opencollective/opencollective-pdf': 'PDF',
  'opencollective/opencollective-rest': 'REST',
  'opencollective/opencollective-images': 'Images',
  'opencollective/opencollective': 'Issue tracker & docs',
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const IMAGE_TYPES = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif' };
const IMAGE_MAX_BYTES = 400 * 1024;
const SUMMARY_MAX_BULLETS = 5;
const SUMMARY_MAX_LENGTH = 180;
const MISC_KINDS = [
  ['fix', 'Fix', 'Fixes'],
  ['improvement', 'Improvement', 'Improvements'],
];

// ---------------------------------------------------------------------------
// Validation

// `baseDir` (the report's directory) enables checks on image files.
export function validateReport(report, { baseDir } = {}) {
  const errors = [];
  const warnings = [];
  const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
  const isCount = value => Number.isInteger(value) && value >= 0;
  const requireString = (value, path) => {
    if (typeof value !== 'string' || !value.trim()) {
      errors.push(`${path} must be a non-empty string`);
    }
  };
  const requireDate = (value, path, optional = false) => {
    if (optional && value === undefined) {
      return;
    }
    if (typeof value !== 'string' || !ISO_DATE.test(value)) {
      errors.push(`${path} must be an ISO date (YYYY-MM-DD)`);
    }
  };

  if (!isObject(report)) {
    return { errors: ['report must be a JSON object'], warnings };
  }

  if (!isObject(report.period)) {
    errors.push('period is required');
  } else {
    requireString(report.period.label, 'period.label');
    requireDate(report.period.start, 'period.start');
    requireDate(report.period.end, 'period.end');
    if (report.period.start > report.period.end) {
      errors.push('period.start must not be after period.end');
    }
  }
  requireDate(report.generatedOn, 'generatedOn');
  if (report.draft !== undefined && typeof report.draft !== 'boolean') {
    errors.push('draft must be true or false');
  }

  const scope = report.scope;
  if (!isObject(scope)) {
    errors.push('scope is required');
  } else {
    for (const flag of ['inProgress', 'offBoard']) {
      if (typeof scope[flag] !== 'boolean') {
        errors.push(`scope.${flag} must be true or false`);
      }
    }
    if (!Array.isArray(scope.repos) || scope.repos.length === 0 || !scope.repos.every(r => /^[\w.-]+\/[\w.-]+$/.test(r))) {
      errors.push('scope.repos must list owner/repo names');
    }
  }

  if (!Array.isArray(report.summary) || report.summary.length === 0) {
    errors.push('summary must be a non-empty array of bullet points');
  } else {
    report.summary.forEach((bullet, i) => requireString(bullet, `summary[${i}]`));
    if (report.summary.length > SUMMARY_MAX_BULLETS) {
      warnings.push(`summary has ${report.summary.length} bullets; keep highlights to ${SUMMARY_MAX_BULLETS} or fewer`);
    }
    report.summary.forEach((bullet, i) => {
      if (typeof bullet === 'string' && bullet.length > SUMMARY_MAX_LENGTH) {
        warnings.push(`summary[${i}] is ${bullet.length} characters; keep each highlight to one short line`);
      }
    });
  }

  const metrics = report.metrics;
  if (!isObject(metrics)) {
    errors.push('metrics is required');
  } else {
    let hasPrevious = false;
    const checkPrevious = (metric, path) => {
      if (metric.previous !== undefined) {
        hasPrevious = true;
        if (!isCount(metric.previous)) {
          errors.push(`${path}.previous must be a non-negative integer`);
        }
      }
    };
    const byRepo = metrics.prsMerged?.byRepo;
    if (!Array.isArray(byRepo) || byRepo.length === 0) {
      errors.push('metrics.prsMerged.byRepo must list { repo, value } per repository');
    } else {
      byRepo.forEach((entry, i) => {
        const at = `metrics.prsMerged.byRepo[${i}]`;
        if (!isObject(entry) || typeof entry.repo !== 'string' || !/^[\w.-]+\/[\w.-]+$/.test(entry.repo)) {
          errors.push(`${at}.repo must be an owner/repo name`);
          return;
        }
        if (!isCount(entry.value)) {
          errors.push(`${at}.value must be a non-negative integer`);
        }
        checkPrevious(entry, at);
      });
    }
    if (!isObject(metrics.issuesClosed) || !isCount(metrics.issuesClosed.value)) {
      errors.push('metrics.issuesClosed.value must be a non-negative integer');
    } else {
      checkPrevious(metrics.issuesClosed, 'metrics.issuesClosed');
    }
    for (const removed of ['contributors', 'shippedPrevious']) {
      if (metrics[removed] !== undefined) {
        errors.push(`metrics.${removed} is no longer reported; remove it`);
      }
    }
    if (hasPrevious) {
      requireString(metrics.previousLabel, 'metrics.previousLabel');
    }
  }

  const validateImages = (images, at) => {
    if (images === undefined) {
      return;
    }
    if (!Array.isArray(images)) {
      errors.push(`${at}.images must be an array`);
      return;
    }
    images.forEach((image, j) => {
      const path = `${at}.images[${j}]`;
      if (!isObject(image)) {
        errors.push(`${path} must be an object`);
        return;
      }
      requireString(image.alt, `${path}.alt`);
      if (image.caption !== undefined) {
        requireString(image.caption, `${path}.caption`);
      }
      if (typeof image.src !== 'string' || isAbsolute(image.src) || normalize(image.src).startsWith('..') || /^[a-z]+:/i.test(image.src)) {
        errors.push(`${path}.src must be a path relative to report.json (no URLs)`);
        return;
      }
      if (!IMAGE_TYPES[extname(image.src).toLowerCase()]) {
        errors.push(`${path}.src must be a ${Object.keys(IMAGE_TYPES).join(', ')} file`);
        return;
      }
      if (baseDir) {
        const file = join(baseDir, image.src);
        if (!existsSync(file)) {
          errors.push(`${path}.src ${image.src} does not exist`);
        } else if (statSync(file).size > IMAGE_MAX_BYTES) {
          warnings.push(`${path}.src ${image.src} is over ${IMAGE_MAX_BYTES / 1024} KB; resize or compress it`);
        }
      }
    });
  };

  const validateItems = (items, path, { optional = false } = {}) => {
    if (items === undefined && optional) {
      return;
    }
    if (!Array.isArray(items)) {
      errors.push(`${path} must be an array`);
      return;
    }
    items.forEach((item, i) => {
      const at = `${path}[${i}]`;
      if (!isObject(item)) {
        errors.push(`${at} must be an object`);
        return;
      }
      requireString(item.title, `${at}.title`);
      requireString(item.url, `${at}.url`);
      requireString(item.area, `${at}.area`);
      if (typeof item.area === 'string' && !AREA_FAMILY.has(item.area)) {
        warnings.push(`${at}.area "${item.area}" is not a known Engineering Area; rendered in neutral colors (update AREAS in build-report.mjs if the board gained an area)`);
      }
      if (item.summary !== undefined) {
        requireString(item.summary, `${at}.summary`);
      }
      requireDate(item.start, `${at}.start`, true);
      requireDate(item.end, `${at}.end`, true);
      if (item.subIssues !== undefined) {
        const { done, total } = isObject(item.subIssues) ? item.subIssues : {};
        if (!isCount(done) || !isCount(total) || done > total) {
          errors.push(`${at}.subIssues must be { done, total } with done <= total`);
        }
      }
      if (item.prs !== undefined && !isCount(item.prs)) {
        errors.push(`${at}.prs must be a non-negative integer`);
      }
      if (item.people !== undefined && (!Array.isArray(item.people) || !item.people.every(p => typeof p === 'string' && /^[A-Za-z0-9-]+$/.test(p)))) {
        errors.push(`${at}.people must be an array of GitHub logins`);
      }
      if (item.done !== undefined) {
        if (path !== 'ongoing') {
          errors.push(`${at}.done is only for ongoing items`);
        } else if (!Array.isArray(item.done)) {
          errors.push(`${at}.done must be an array of { title, url } or { title, links }`);
        } else {
          item.done.forEach((entry, j) => {
            if (!isObject(entry)) {
              errors.push(`${at}.done[${j}] must be an object`);
              return;
            }
            requireString(entry.title, `${at}.done[${j}].title`);
            if (entry.links !== undefined) {
              if (entry.url !== undefined || !Array.isArray(entry.links) || entry.links.length < 2) {
                errors.push(`${at}.done[${j}] takes either url or links (two or more pull requests), not both`);
              } else {
                entry.links.forEach((link, k) => requireString(link, `${at}.done[${j}].links[${k}]`));
              }
            } else {
              requireString(entry.url, `${at}.done[${j}].url`);
            }
          });
        }
      }
      validateImages(item.images, at);
    });
  };

  validateItems(report.shipped, 'shipped');
  validateItems(report.ongoing, 'ongoing', { optional: true });

  if (isObject(scope)) {
    for (const key of ['inProgress', 'next']) {
      if (scope.inProgress === true) {
        validateItems(report[key], key, { optional: true });
      } else if (report[key] !== undefined) {
        errors.push(`${key} must be omitted when scope.inProgress is false`);
      }
    }
    if (scope.offBoard === true) {
      if (!Array.isArray(report.misc)) {
        errors.push('misc must be an array when scope.offBoard is true');
      } else {
        report.misc.forEach((entry, i) => {
          const at = `misc[${i}]`;
          if (!isObject(entry)) {
            errors.push(`${at} must be an object`);
            return;
          }
          requireString(entry.title, `${at}.title`);
          if (entry.url !== undefined) {
            requireString(entry.url, `${at}.url`);
          }
          if (entry.topic !== undefined) {
            requireString(entry.topic, `${at}.topic`);
          }
          if (!MISC_KINDS.some(([kind]) => kind === entry.kind)) {
            errors.push(`${at}.kind must be "fix" or "improvement"`);
          }
        });
        const withTopic = report.misc.filter(entry => isObject(entry) && entry.topic !== undefined).length;
        if (withTopic && withTopic !== report.misc.length) {
          errors.push('misc entries must all have a topic, or none');
        }
      }
    } else if (report.misc !== undefined) {
      errors.push('misc must be omitted when scope.offBoard is false');
    }
  }

  return { errors, warnings };
}

// ---------------------------------------------------------------------------
// Formatting helpers

export function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function profileLink(login) {
  return `<a class="handle" href="https://github.com/${escapeHtml(login)}">@${escapeHtml(login)}</a>`;
}

// Escapes text, turns owner/repo#123 references into GitHub links and @handles into profile links.
export function richText(text) {
  return escapeHtml(text)
    .replace(
      /\b([\w.-]+)\/([\w.-]+)#(\d+)\b/g,
      (match, owner, repo, number) => `<a href="https://github.com/${owner}/${repo}/issues/${number}">${match}</a>`,
    )
    .replace(/(^|[^\w/@.-])@([A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?)\b/g, (match, before, login) => `${before}${profileLink(login)}`);
}

function parseDate(iso) {
  const [year, month, day] = iso.split('-').map(Number);
  return { year, month, day };
}

export function formatDate(iso, referenceYear) {
  const { year, month, day } = parseDate(iso);
  const short = `${MONTHS[month - 1]} ${day}`;
  return year === referenceYear ? short : `${short}, ${year}`;
}

function formatRange(start, end, referenceYear) {
  if (start && end) {
    return `${formatDate(start, referenceYear)} → ${formatDate(end, referenceYear)}`;
  }
  if (start) {
    return `Started ${formatDate(start, referenceYear)}`;
  }
  return end ? `Completed ${formatDate(end, referenceYear)}` : null;
}

// "#123" for the main tracker, "opencollective-api#123" elsewhere.
export function shortRef(url) {
  const match = /github\.com\/([^/]+)\/([^/]+)\/(?:issues|pull)\/(\d+)/.exec(url ?? '');
  if (!match) {
    return '';
  }
  const [, owner, repo, number] = match;
  if (owner === 'opencollective' && repo === 'opencollective') {
    return `#${number}`;
  }
  return owner === 'opencollective' ? `${repo}#${number}` : `${owner}/${repo}#${number}`;
}

export function repoLabel(repo) {
  if (REPO_LABELS[repo]) {
    return REPO_LABELS[repo];
  }
  const name = repo.split('/').pop().replace(/^opencollective-/, '');
  return name.charAt(0).toUpperCase() + name.slice(1);
}

function repoFromUrl(url) {
  const match = /github\.com\/([^/]+\/[^/]+)\//.exec(url ?? '');
  return match ? match[1] : null;
}

function plural(count, word) {
  return `${count} ${word}${count === 1 ? '' : 's'}`;
}

function slug(value) {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function areaFamily(area) {
  return AREA_FAMILY.get(area) ?? 'other';
}

function areaPill(area) {
  return `<span class="pill area-${areaFamily(area)}">${escapeHtml(area)}</span>`;
}

function peopleList(people) {
  return people?.length ? people.map(profileLink).join(', ') : null;
}

// Stable order: board area order, then title.
function sortByArea(items) {
  const rank = area => AREA_ORDER.get(area) ?? AREAS.length;
  return [...items].sort((a, b) => rank(a.area) - rank(b.area) || a.area.localeCompare(b.area) || a.title.localeCompare(b.title));
}

// ---------------------------------------------------------------------------
// Render context: collects the CSS rules that filters need and inlines images.

function createContext(baseDir) {
  return { baseDir, css: [], imageCount: 0 };
}

function imageDataUri(context, src) {
  if (!context.baseDir) {
    throw new Error(`Cannot inline ${src}: renderReport needs { baseDir } for reports with images`);
  }
  const data = readFileSync(join(context.baseDir, src));
  return `data:${IMAGE_TYPES[extname(src).toLowerCase()]};base64,${data.toString('base64')}`;
}

// Screenshots open full size when clicked: a visually hidden checkbox toggles a fixed overlay, no script needed.
function renderImages(context, images) {
  if (!images?.length) {
    return '';
  }
  return `<div class="shots">${images
    .map(image => {
      const id = `shot-${++context.imageCount}`;
      const caption = image.caption ? `<figcaption>${richText(image.caption)}</figcaption>` : '';
      return `<figure class="shot"><input type="checkbox" class="zoom-toggle" id="${id}" aria-label="Enlarge screenshot: ${escapeHtml(image.alt)}"><label for="${id}" class="zoom" title="Click to enlarge"><img src="${imageDataUri(context, image.src)}" alt="${escapeHtml(image.alt)}" loading="lazy"></label>${caption}</figure>`;
    })
    .join('')}</div>`;
}

// Quick filters: one radio group per section. Each option hides the items whose
// data-filter differs, using :has(), so the page needs no script.
function renderFilters(context, sectionId, label, options, total) {
  const name = `filter-${sectionId}`;
  const radios = [{ key: 'all', label: 'All', count: total }, ...options].map(option => {
    const id = `${name}-${option.key}`;
    if (option.key !== 'all') {
      context.css.push(
        `#${sectionId}:has(#${id}:checked) [data-filter]:not([data-filter="${option.key}"]) { display: none; }`,
        `#${sectionId}:has(#${id}:checked) [data-filter-group]:not(:has([data-filter="${option.key}"])) { display: none; }`,
      );
    } else {
      // Group counts are totals: hide them while a filter narrows the groups.
      context.css.push(`#${sectionId}:has(.filter-input:checked:not(#${id})) [data-filter-group] .count { display: none; }`);
    }
    return `<input type="radio" class="filter-input" name="${name}" id="${id}"${option.key === 'all' ? ' checked' : ''}><label class="filter" for="${id}">${escapeHtml(option.label)}<span class="filter-count">${option.count}</span></label>`;
  });
  return `<div class="filters" role="radiogroup" aria-label="${escapeHtml(label)}">${radios.join('')}</div>`;
}

// Area filters are worth showing once a section mixes areas and has a few items.
function areaFilters(context, sectionId, items) {
  const counts = new Map();
  for (const item of sortByArea(items)) {
    counts.set(item.area, (counts.get(item.area) ?? 0) + 1);
  }
  if (counts.size < 2 || items.length < 4) {
    return '';
  }
  const options = [...counts].map(([area, count]) => ({ key: slug(area), label: area, count }));
  return renderFilters(context, sectionId, 'Filter by engineering area', options, items.length);
}

// ---------------------------------------------------------------------------
// Sections

// Every section the report shows, in page order. Empty sections are left out.
function sectionsOf(report) {
  const list = [{ id: 'shipped', title: 'Shipped projects' }];
  if (report.scope.inProgress && report.inProgress?.length) {
    list.push({ id: 'in-progress', title: 'In progress' });
  }
  if (report.ongoing?.length) {
    list.push({ id: 'ongoing', title: 'Ongoing work' });
  }
  if (report.scope.inProgress && report.next?.length) {
    list.push({ id: 'next', title: 'Up next' });
  }
  if (report.scope.offBoard && report.misc.length) {
    list.push({ id: 'misc', title: 'Misc fixes and improvements' });
  }
  return list;
}

function renderHeader(report) {
  const { period } = report;
  const year = parseDate(period.end).year;
  const chips = sectionsOf(report).map(
    section => `<a class="chip" href="#${section.id}"><span class="dot dot-${section.id}" aria-hidden="true"></span>${section.title}</a>`,
  );
  return `
  <header class="report-header">
    <div>
      <p class="eyebrow"><span class="eyebrow-mark" aria-hidden="true"></span>Open Collective engineering</p>
      <h1>Engineering report: ${escapeHtml(period.label)}</h1>
      <p class="period">${formatDate(period.start, year)} – ${formatDate(period.end, null)} · Generated ${formatDate(report.generatedOn, year)}</p>
    </div>
    <nav class="chips" aria-label="Sections">
      ${chips.join('')}
    </nav>
  </header>`;
}

function deltaBadge(value, previous, previousLabel) {
  if (!(previous > 0)) {
    return '';
  }
  const change = Math.round(((value - previous) / previous) * 100);
  const rotation = change > 0 ? -45 : change < 0 ? 45 : 0;
  const arrow = `<svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" style="transform:rotate(${rotation}deg)"><path d="M2 6h8M7 3l3 3-3 3" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  const sign = change > 0 ? '+' : change < 0 ? '−' : '';
  return `<span class="delta" title="Change vs ${escapeHtml(previousLabel)}">${arrow}${sign}${Math.abs(change)}%</span>`;
}

function previousLine(previous, previousLabel) {
  return previous === undefined ? '' : `<p class="tile-previous">${previous.toLocaleString('en-US')} in ${escapeHtml(previousLabel)}</p>`;
}

// Total merged pull requests, then one bar per repository (single hue: the bars compare magnitudes).
function renderPrTile(metrics) {
  const repos = [...metrics.prsMerged.byRepo].sort((a, b) => b.value - a.value);
  const total = repos.reduce((sum, entry) => sum + entry.value, 0);
  const previousTotal = repos.every(entry => entry.previous !== undefined) ? repos.reduce((sum, entry) => sum + entry.previous, 0) : undefined;
  const max = Math.max(1, ...repos.map(entry => entry.value));
  const rows = repos
    .map(entry => {
      const label = repoLabel(entry.repo);
      const width = entry.value ? Math.max(2, Math.round((entry.value / max) * 100)) : 0;
      const previous = entry.previous === undefined ? '<span></span>' : `<span class="bar-previous">${escapeHtml(shortMonth(metrics.previousLabel))}: ${entry.previous}</span>`;
      return `
        <li class="bar-row" title="${escapeHtml(label)}: ${entry.value} merged${entry.previous === undefined ? '' : `, ${entry.previous} in ${escapeHtml(metrics.previousLabel)}`}">
          <a class="bar-label" href="https://github.com/${escapeHtml(entry.repo)}">${escapeHtml(label)}</a>
          <span class="bar-track"><span class="bar-fill" style="width:${width}%"></span></span>
          <span class="bar-value">${entry.value}</span>${previous}
        </li>`;
    })
    .join('');
  return `
    <div class="tile tile-wide">
      <p class="tile-label">Pull requests merged</p>
      <p class="tile-value">${total.toLocaleString('en-US')}${deltaBadge(total, previousTotal, metrics.previousLabel)}</p>
      ${previousLine(previousTotal, metrics.previousLabel)}
      <ul class="bars" aria-label="Pull requests merged per repository">${rows}
      </ul>
    </div>`;
}

// "September 2026" → "Sep"; other labels are kept as they are.
function shortMonth(label) {
  const month = MONTHS.find(m => label?.startsWith(m));
  return month ?? label;
}

function renderStats(report) {
  const { metrics } = report;
  const issues = metrics.issuesClosed;
  return `
  <section class="stats" aria-label="Key numbers">
    ${renderPrTile(metrics)}
    <div class="tile">
      <p class="tile-label">Issues closed</p>
      <p class="tile-value">${issues.value.toLocaleString('en-US')}${deltaBadge(issues.value, issues.previous, metrics.previousLabel)}</p>
      ${previousLine(issues.previous, metrics.previousLabel)}
    </div>
  </section>`;
}

function sectionTitle(id, title, count) {
  const badge = count === undefined ? '' : `<span class="count">${count}</span>`;
  const dot = id ? `<span class="dot dot-${id}" aria-hidden="true"></span>` : '';
  return `<h2 class="section-title">${dot}${title}${badge}</h2>`;
}

function renderSummary(report) {
  return `
  <section class="section" id="highlights">
    ${sectionTitle(null, 'Highlights')}
    <ul class="summary">${report.summary.map(bullet => `<li>${richText(bullet)}</li>`).join('')}</ul>
  </section>`;
}

function metaList(entries) {
  const items = entries.filter(Boolean);
  return items.length ? `<ul class="meta">${items.map(m => `<li>${m}</li>`).join('')}</ul>` : '';
}

function titleLink(item) {
  return `<h3 class="card-title"><a href="${escapeHtml(item.url)}">${escapeHtml(item.title)}</a><span class="ref">${shortRef(item.url)}</span></h3>`;
}

function renderCard(context, item, year) {
  return `
        <article class="card card-tinted area-${areaFamily(item.area)}${item.images?.length ? ' card-wide' : ''}" data-filter="${slug(item.area)}">
          <div class="card-body">
            ${areaPill(item.area)}
            ${titleLink(item)}
            ${item.summary ? `<p class="card-summary">${richText(item.summary)}</p>` : ''}
            ${metaList([
              escapeHtml(formatRange(item.start, item.end, year) ?? '') || null,
              item.subIssues?.total ? `${item.subIssues.done}/${plural(item.subIssues.total, 'sub-issue')}` : null,
              item.prs ? plural(item.prs, 'PR') : null,
              peopleList(item.people),
            ])}
          </div>
          ${renderImages(context, item.images)}
        </article>`;
}

function renderShipped(context, report) {
  const year = parseDate(report.period.end).year;
  const body = report.shipped.length
    ? `${areaFilters(context, 'shipped', report.shipped)}<div class="cards">${sortByArea(report.shipped)
        .map(item => renderCard(context, item, year))
        .join('')}
    </div>`
    : '<p class="empty">No board project was completed during this period.</p>';
  return `
  <section class="section" id="shipped">
    ${sectionTitle('shipped', 'Shipped projects', report.shipped.length)}
    <p class="section-intro">Board projects completed during the period.</p>
    ${body}
  </section>`;
}

function renderRow(context, item, year, withProgress) {
  let side = '';
  if (withProgress && item.subIssues?.total) {
    const percent = Math.round((item.subIssues.done / item.subIssues.total) * 100);
    side = `
        <div class="row-side">${item.subIssues.done} of ${plural(item.subIssues.total, 'sub-issue')} done
          <div class="meter" role="img" aria-label="${percent}% of sub-issues done"><div class="meter-fill" style="width:${percent}%"></div></div>
        </div>`;
  }
  return `
      <li class="row" data-filter="${slug(item.area)}">
        <div class="row-main">
          <div class="row-head">${areaPill(item.area)}${titleLink(item)}</div>
          ${item.summary ? `<p class="card-summary">${richText(item.summary)}</p>` : ''}
          ${metaList([
            withProgress && item.start ? escapeHtml(formatRange(item.start, null, year)) : null,
            item.prs ? `${plural(item.prs, 'PR')} this period` : null,
            peopleList(item.people),
          ])}
          ${renderImages(context, item.images)}
        </div>${side || '<div></div>'}
      </li>`;
}

function renderRowSection(context, id, title, intro, items, year, withProgress) {
  return `
  <section class="section" id="${id}">
    ${sectionTitle(id, title, items.length)}
    <p class="section-intro">${intro}</p>
    ${areaFilters(context, id, items)}
    <ul class="rows">${sortByArea(items)
      .map(item => renderRow(context, item, year, withProgress))
      .join('')}
    </ul>
  </section>`;
}

// Ongoing items have no end: show only what was done during the period, not overall progress.
function renderOngoing(context, report) {
  const label = report.period.label;
  const rows = sortByArea(report.ongoing)
    .map(item => {
      const done = item.done?.length
        ? `<div class="done"><p class="done-title">Done in ${escapeHtml(label)}<span class="count">${item.done.length}</span></p><ul class="done-list">${item.done
            .map(entry => {
              // One change can span several services: the title links its only PR, or each service tag links its own.
              if (entry.links) {
                const tags = entry.links.map(link => `<a class="tag" href="${escapeHtml(link)}" title="${escapeHtml(shortRef(link))}">${escapeHtml(repoLabel(repoFromUrl(link) ?? ''))}</a>`);
                return `<li><span>${escapeHtml(entry.title)}</span><span class="tags">${tags.join('')}</span></li>`;
              }
              const repo = repoFromUrl(entry.url);
              return `<li><a href="${escapeHtml(entry.url)}">${escapeHtml(entry.title)}</a>${repo ? `<span class="tags"><span class="tag">${escapeHtml(repoLabel(repo))}</span></span>` : ''}</li>`;
            })
            .join('')}</ul></div>`
        : '';
      return `
      <li class="row row-ongoing" data-filter="${slug(item.area)}">
        <div class="row-main">
          <div class="row-head">${areaPill(item.area)}${titleLink(item)}</div>
          ${item.summary ? `<p class="card-summary">${richText(item.summary)}</p>` : ''}
          ${metaList([item.prs ? `${plural(item.prs, 'PR')} this period` : null, peopleList(item.people)])}
          ${done}
        </div>
      </li>`;
    })
    .join('');
  return `
  <section class="section" id="ongoing">
    ${sectionTitle('ongoing', 'Ongoing work', report.ongoing.length)}
    <p class="section-intro">Continuous work with no end date, and what was done on it during the period.</p>
    ${areaFilters(context, 'ongoing', report.ongoing)}
    <ul class="rows">${rows}
    </ul>
  </section>`;
}

// Misc entries are grouped by topic when topics are set, with a kind badge and repository tag on each line.
function renderMisc(context, report) {
  const kinds = MISC_KINDS.map(([kind, , label]) => ({ key: kind, label, count: report.misc.filter(entry => entry.kind === kind).length })).filter(
    option => option.count,
  );
  const filters = kinds.length > 1 ? renderFilters(context, 'misc', 'Filter by kind', kinds, report.misc.length) : '';
  const line = entry => {
    const kindLabel = MISC_KINDS.find(([kind]) => kind === entry.kind)[1];
    const title = entry.url ? `<a href="${escapeHtml(entry.url)}">${escapeHtml(entry.title)}</a>` : escapeHtml(entry.title);
    const repo = repoFromUrl(entry.url);
    return `<li class="misc-item" data-filter="${entry.kind}"><span class="kind kind-${entry.kind}">${kindLabel}</span><span class="misc-title">${title}</span>${repo ? `<span class="tag">${escapeHtml(repoLabel(repo))}</span>` : ''}</li>`;
  };
  const byKind = (a, b) => MISC_KINDS.findIndex(([k]) => k === a.kind) - MISC_KINDS.findIndex(([k]) => k === b.kind);
  const topics = new Map();
  for (const entry of report.misc) {
    const topic = entry.topic ?? '';
    topics.set(topic, [...(topics.get(topic) ?? []), entry]);
  }
  const groups = [...topics]
    .sort(([a, x], [b, y]) => y.length - x.length || a.localeCompare(b))
    .map(
      ([topic, entries]) => `
      <div class="misc-group" data-filter-group>
        ${topic ? `<h3>${escapeHtml(topic)}<span class="count">${entries.length}</span></h3>` : ''}
        <ul>${[...entries].sort(byKind).map(line).join('')}</ul>
      </div>`,
    )
    .join('');
  return `
  <section class="section" id="misc">
    ${sectionTitle('misc', 'Misc fixes and improvements', report.misc.length)}
    <p class="section-intro">Smaller changes merged during the period that are not part of a board project.</p>
    ${filters}
    <div class="misc${topics.size > 1 ? '' : ' misc-single'}">${groups}
    </div>
  </section>`;
}

function renderFooter(report) {
  const { scope } = report;
  const repos = report.metrics.prsMerged.byRepo
    .map(({ repo }) => `<a href="https://github.com/${escapeHtml(repo)}">${escapeHtml(repo)}</a>`)
    .join(', ');
  const included = [
    'projects completed on the board',
    report.ongoing?.length ? 'what was done on ongoing work' : null,
    scope.inProgress ? 'current work in progress and upcoming priorities' : null,
    scope.offBoard ? 'smaller work merged outside the board' : null,
  ].filter(Boolean);
  return `
  <footer class="report-footer">
    <p>Built from the <a href="${BOARD_URL}">Engineering Board</a>. Includes ${included.join(', ')}.</p>
    <p>Numbers cover pull requests merged in ${repos}, excluding automated dependency updates, and issues closed as completed in <a href="https://github.com/opencollective/opencollective">opencollective/opencollective</a>.</p>
  </footer>`;
}

// `baseDir` is the report's directory, needed when items have images.
export function renderReport(report, { css = readFileSync(join(ASSETS, 'style.css'), 'utf8'), baseDir } = {}) {
  const context = createContext(baseDir);
  const year = parseDate(report.period.end).year;
  const sections = [renderHeader(report), renderStats(report), renderSummary(report), renderShipped(context, report)];
  const present = new Set(sectionsOf(report).map(section => section.id));
  if (present.has('in-progress')) {
    sections.push(renderRowSection(context, 'in-progress', 'In progress', 'Board projects still being worked on.', report.inProgress, year, true));
  }
  if (present.has('ongoing')) {
    sections.push(renderOngoing(context, report));
  }
  if (present.has('next')) {
    sections.push(renderRowSection(context, 'next', 'Up next', 'Priorities queued to start next.', report.next, year, false));
  }
  if (present.has('misc')) {
    sections.push(renderMisc(context, report));
  }
  sections.push(renderFooter(report));

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Engineering report: ${escapeHtml(report.period.label)}</title>
<style>
${css}${context.css.length ? `\n/* Quick filters for this report */\n${context.css.join('\n')}\n` : ''}</style>
</head>
<body>
<main class="report">${sections.join('\n')}
</main>
</body>
</html>
`;
}

// ---------------------------------------------------------------------------
// CLI

function main([input, output]) {
  if (!input) {
    console.error('Usage: node build-report.mjs <report.json> [out.html]');
    process.exit(2);
  }
  const inputPath = resolve(input);
  const baseDir = dirname(inputPath);
  const outputPath = resolve(output ?? join(baseDir, 'report.html'));
  let report;
  try {
    report = JSON.parse(readFileSync(inputPath, 'utf8'));
  } catch (error) {
    console.error(`Cannot read ${inputPath}: ${error.message}`);
    process.exit(1);
  }
  const { errors, warnings } = validateReport(report, { baseDir });
  warnings.forEach(warning => console.error(`warning: ${warning}`));
  if (errors.length) {
    console.error(`${inputPath} is invalid:`);
    errors.forEach(error => console.error(`  - ${error}`));
    process.exit(1);
  }
  writeFileSync(outputPath, renderReport(report, { baseDir }));
  console.log(`Wrote ${outputPath}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2));
}
