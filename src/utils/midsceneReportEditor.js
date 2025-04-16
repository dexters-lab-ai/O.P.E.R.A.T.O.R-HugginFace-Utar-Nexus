// src/utils/midsceneReportEditor.js

import fs from 'fs';
import { Parser } from 'htmlparser2';


// Custom CSS to inject into every report’s `<head>`
const customCss = `
/* General styling overrides */
body { background:linear-gradient(to bottom,#1a1a1a,#000); color:#e8e8e8; }
.side-bar,.page-nav,.panel-title { background:#000!important; color:#e8e8e8!important; }
.main-right .main-content-container,.detail-panel { background:#111!important; color:#FFF!important; }
.detail-side .item-list .item, .page-nav, .page-side,
.main-right .main-content-container, .detail-side .meta-kv, .timeline-wrapper {
  border-color:#333!important;
}
a, .side-item-name, .meta-key, .meta-value { color:#e8e8e8!important; }
/* Branding/logo replacers */
img[src*="Midscene.png" i], img[alt*="midscene" i], img[class*="logo" i], img[src*="logo" i] {
  content:url("/assets/images/dail-fav.png")!important; width:50px!important; height:50px!important;
}
/* Version update */
.task-list-sub-name { visibility:hidden; position:relative; }
.task-list-sub-name::after {
  content:"v1.0.1, OPERATOR model"; visibility:visible; position:absolute; left:0; color:#e8e8e8;
}
`;

/**
 * Edit an existing Midscene SDK–generated HTML report file in place:
 *   - Replace title, favicon, logos
 *   - Update any embedded JSON dump (sdkVersion/groupName)
 *   - Inject our `customCss` into <head>
 *
 * @param {string} reportPath  - Path to the Midscene report HTML.
 * @returns {Promise<string>}  - Resolves to same path after writing.
 */
export async function editMidsceneReport(reportPath) {
  console.log(`[MidsceneReport] Editing report at ${reportPath}`);

  const tempPath   = `${reportPath}.tmp`;
  const readStream  = fs.createReadStream(reportPath, 'utf8');
  const writeStream = fs.createWriteStream(tempPath,  'utf8');

  let insideTitle   = false;
  let insideScript  = false;
  let scriptContent = '';
  let insideHead    = false;
  let cssInjected   = false;

  const parser = new Parser({
    onopentag(name, attrs) {
      if (name === 'title') {
        writeStream.write('<title>VLM Run Report | O.P.E.R.A.T.O.R.</title>');
        insideTitle = true;

      } else if (name === 'link' && attrs.rel === 'icon') {
        writeStream.write('<link rel="icon" href="/assets/images/dail-fav.png" type="image/png" sizes="32x32">');

      } else if (
        name === 'img' &&
        (
          (attrs.src?.toLowerCase().includes('midscene.png')) ||
          (attrs.alt?.toLowerCase().includes('midscene'))   ||
          (attrs.class?.toLowerCase().includes('logo'))     ||
          (attrs.src?.toLowerCase().includes('logo'))
        )
      ) {
        writeStream.write(
          '<img src="/assets/images/dail-fav.png" alt="OPERATOR_logo" class="logo" width="50" height="50">'
        );

      } else if (name === 'script' && attrs.type === 'midscene_web_dump') {
        insideScript  = true;
        scriptContent = '';
        writeStream.write('<script type="midscene_web_dump" application/json>');

      } else {
        // Write tag + all attributes
        const attrString = Object.entries(attrs || {})
          .map(([k,v]) => ` ${k}="${v}"`)
          .join('');
        writeStream.write(`<${name}${attrString}>`);
      }

      if (name === 'head') {
        insideHead = true;
      }
    },

    ontext(text) {
      if (insideScript) {
        scriptContent += text;
      } else if (!insideTitle) {
        writeStream.write(text);
      }
    },

    onclosetag(name) {
      if (name === 'title') {
        insideTitle = false;

      } else if (name === 'script' && insideScript) {
        // Try to parse & patch the JSON dump
        try {
          let jsonStr = scriptContent.trim();
          if (!jsonStr.endsWith('}')) {
            jsonStr += '"}]}'; // attempt to close truncated JSON
          }
          const data = JSON.parse(jsonStr);
          if (Array.isArray(data.executions)) {
            data.executions.forEach(exec => { exec.sdkVersion = '1.0.1'; });
          }
          data.groupName = 'O.P.E.R.A.T.O.R – Sentinel Report';
          writeStream.write(JSON.stringify(data));

        } catch (err) {
          console.error('[MidsceneReport] JSON parse error, writing raw dump:', err);
          writeStream.write(scriptContent);
        }

        writeStream.write('</script>');
        insideScript = false;

      } else if (name === 'head' && insideHead) {
        if (!cssInjected) {
          // Inject our custom CSS
          writeStream.write(`\n<style>${customCss}</style>\n`);
          cssInjected = true;
        }
        writeStream.write('</head>');
        insideHead = false;

      } else {
        writeStream.write(`</${name}>`);
      }
    },

    onerror(err) {
      console.error('[MidsceneReport] Parser error:', err);
    }
  }, { decodeEntities: true });

  // Pipe through parser
  readStream.on('data', chunk => parser.write(chunk));
  readStream.on('end',  ()    => { parser.end(); writeStream.end(); });
  readStream.on('error', err  => { console.error('[MidsceneReport] Read error:', err); writeStream.end(); });

  // Replace original when done
  return new Promise((resolve, reject) => {
    writeStream.on('finish', () => {
      fs.renameSync(tempPath, reportPath);
      console.log(`[MidsceneReport] Updated report at ${reportPath}`);
      resolve(reportPath);
    });
    writeStream.on('error', reject);
  });
}
