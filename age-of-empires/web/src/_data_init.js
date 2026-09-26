// FOUNDATION-OWNED. The JS equivalent of `import game.data` in Python: data.py imports the content package at its
// end and then relabels the tables from the locale. ES modules cannot import content from data.js (content imports
// data -> a cycle with uninitialised bindings), so this module does it in the same order:
//   data.js  ->  content/__init__.js (registers every content module, alphabetically)  ->  i18n.relabel()
// Import it (or _all.js, which imports it first) before using the tables.
import * as data from './data.js';
import * as content from './content/__init__.js';
import * as i18n from './i18n.js';

i18n.relabel();

export { data, content, i18n };
