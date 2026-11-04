'use strict';

// Report reasons offered in the UI. Loaded from report-reasons.json so they're
// easy to edit. Each reason has at least { id, label }; integrations may add
// extra fields (they pass through untouched).

const fs = require('fs');
const path = require('path');

let reasons = [];
try {
  const raw = JSON.parse(fs.readFileSync(path.join(__dirname, 'report-reasons.json'), 'utf8'));
  reasons = (Array.isArray(raw) ? raw : raw.reasons || []).filter((r) => r && r.id && r.label);
} catch {
  reasons = [];
}
if (reasons.length === 0) reasons = [{ id: 'other', label: 'Something else' }];

module.exports = reasons;
