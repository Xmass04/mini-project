// content.js — ApplyAI: runs on every page

// Map of common field name patterns → resume keys
const FIELD_MAP = {
  // Personal
  'first.?name|firstname|fname'            : 'firstName',
  'last.?name|lastname|lname'              : 'lastName',
  'full.?name|name'                        : 'fullName',
  'email|e-mail'                           : 'email',
  'phone|mobile|tel'                       : 'phone',
  'address|street'                         : 'address',
  'city'                                   : 'city',
  'state|province'                         : 'state',
  'zip|postal'                             : 'zip',
  'country'                                : 'country',
  'linkedin'                               : 'linkedin',
  'github|portfolio|website'               : 'website',

  // Professional
  'title|position|role|job.?title'         : 'jobTitle',
  'company|employer|organization'          : 'currentCompany',
  'experience|years'                       : 'yearsExperience',
  'salary|compensation|expected'           : 'expectedSalary',
  'summary|objective|about|bio'            : 'summary',
  'skills|technologies'                    : 'skills',
  'education|degree|university|school'     : 'education',
};

// ── Collect Form Fields ───────────────────────────────
function getFormFields() {
  const inputs = document.querySelectorAll(
    'input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="checkbox"]):not([type="radio"]):not([type="file"]), textarea, select'
  );

  const fields = [];
  inputs.forEach((el) => {
    const id    = (el.id || '').toLowerCase();
    const name  = (el.name || '').toLowerCase();
    const placeholder = (el.placeholder || '').toLowerCase();
    const label = getLabel(el).toLowerCase();
    const identifier = `${id} ${name} ${placeholder} ${label}`;

    // Find which resume key this field maps to
    let resumeKey = null;
    for (const [pattern, key] of Object.entries(FIELD_MAP)) {
      if (new RegExp(pattern, 'i').test(identifier)) {
        resumeKey = key;
        break;
      }
    }

    fields.push({
      selector: getSelector(el),
      type: el.tagName.toLowerCase() === 'select' ? 'select'
           : el.tagName.toLowerCase() === 'textarea' ? 'textarea'
           : el.type || 'text',
      label: getLabel(el),
      placeholder: el.placeholder || '',
      name: el.name || el.id || '',
      resumeKey,
      currentValue: el.value || ''
    });
  });

  return fields;
}

// ── Fill Form ─────────────────────────────────────────
function fillForm(data) {
  let count = 0;
  for (const [selector, value] of Object.entries(data)) {
    try {
      const el = document.querySelector(selector);
      if (!el || !value) continue;

      // Native input value setter (works with React/Vue controlled inputs)
      const nativeSetter = Object.getOwnPropertyDescriptor(
        el.tagName === 'TEXTAREA'
          ? window.HTMLTextAreaElement.prototype
          : window.HTMLInputElement.prototype,
        'value'
      );
      if (nativeSetter) {
        nativeSetter.set.call(el, value);
      } else {
        el.value = value;
      }

      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      el.style.transition = 'background 0.5s';
      el.style.background = 'rgba(99, 102, 241, 0.12)';
      setTimeout(() => { el.style.background = ''; }, 1500);
      count++;
    } catch (e) {
      // skip fields that fail
    }
  }
  return count;
}

// ── Get Label Text for an Input ───────────────────────
function getLabel(el) {
  if (el.labels && el.labels.length > 0) {
    return el.labels[0].textContent.trim();
  }
  const id = el.id;
  if (id) {
    const lbl = document.querySelector(`label[for="${id}"]`);
    if (lbl) return lbl.textContent.trim();
  }
  // Walk up for wrapping label
  let parent = el.parentElement;
  while (parent && parent.tagName !== 'BODY') {
    if (parent.tagName === 'LABEL') return parent.textContent.trim();
    parent = parent.parentElement;
  }
  return '';
}

// ── Build a unique CSS selector ───────────────────────
function getSelector(el) {
  if (el.id) return `#${CSS.escape(el.id)}`;
  if (el.name) return `[name="${CSS.escape(el.name)}"]`;

  // Build path
  const parts = [];
  let node = el;
  while (node && node !== document.body) {
    let part = node.tagName.toLowerCase();
    if (node.className) {
      const cls = [...node.classList].slice(0, 2).join('.');
      if (cls) part += `.${cls}`;
    }
    const siblings = node.parentElement
      ? [...node.parentElement.children].filter(c => c.tagName === node.tagName)
      : [];
    if (siblings.length > 1) {
      const idx = siblings.indexOf(node) + 1;
      part += `:nth-of-type(${idx})`;
    }
    parts.unshift(part);
    node = node.parentElement;
  }
  return parts.join(' > ');
}

// ── Message Listener ──────────────────────────────────
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.action === 'getFormFields') {
    sendResponse(getFormFields());
    return true;
  }

  if (message.action === 'fillForm') {
    const count = fillForm(message.data);
    sendResponse({ success: true, count });
    return true;
  }

  if (message.action === 'getPageText') {
    // Extract visible text, trimming boilerplate
    const text = document.body.innerText.slice(0, 8000);
    sendResponse(text);
    return true;
  }
});
