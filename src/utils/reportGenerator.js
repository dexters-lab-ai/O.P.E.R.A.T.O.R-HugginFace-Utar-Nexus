// src/utils/reportGenerator.js

import fs from 'fs';
import path from 'path';

/**
 * Generate a static HTML “landing” report for a finished task.
 *
 * @param {string} prompt        - The user’s original prompt/command.
 * @param {Array<Object>} results - Array of per-step results (error, screenshotPath, summary, etc.).
 * @param {string|null} screenshotPath - Final screenshot URL or path (optional).
 * @param {string} runId         - Unique run identifier (used in filenames/URLs).
 * @param {string} reportDir     - Filesystem directory where to write the report.
 * @returns {string}             - Absolute path to the written HTML report file.
 */
export async function generateReport(prompt, results, screenshotPath, runId, reportDir) {
  console.log(`[LandingReport] Generating landing report for run ${runId}`);

  // Compose the HTML in a template literal:
  const reportHTML = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <title>O.P.E.R.A.T.O.R Report</title>
  <link rel="icon" href="/assets/images/dail-fav.png">
  <style>
    body { background: linear-gradient(to bottom, #1a1a1a, #000); color: #e8e8e8; font-family: Arial, sans-serif; }
    .container { max-width:1200px; margin:0 auto; padding:20px; }
    .header { display:flex; align-items:center; margin-bottom:30px; }
    .logo { width:50px; margin-right:20px; }
    .replay-button { margin-left:auto; padding:10px 20px; background:dodgerblue; color:#000; text-decoration:none; border-radius:5px; font-weight:bold; }
    .replay-button:hover { background:#1e90ff; }
    .content { background:#111; padding:20px; border-radius:10px; }
    .screenshot { max-width:100%; border-radius:5px; margin:20px 0; }
    .task { background:#222; padding:15px; margin-bottom:15px; border-radius:5px; }
    .task-header { font-weight:bold; margin-bottom:10px; }
    .detail-content { background:dodgerblue; border-radius:10px; padding:10px; color:#000; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <img src="/assets/images/dail-fav.png" alt="OPERATOR_logo" class="logo"/>
      <h1>O.P.E.R.A.T.O.R – Sentinel Report</h1>
      <a id="replayButton" href="#" class="replay-button">Replay</a>
    </div>
    <div class="content">
      <h2>Task Details</h2>
      <div class="detail-content">
        <p><strong>Command:</strong> ${prompt}</p>
        <p><strong>Run ID:</strong> ${runId}</p>
        <p><strong>Timestamp:</strong> ${new Date().toISOString()}</p>
      </div>
      <h2>Execution Results</h2>
      ${results.slice(0, 10).map((result, i) => {
        if (result.error) {
          return `
            <div class="task error">
              <div class="task-header">Step ${i+1} – Error</div>
              <pre>${JSON.stringify(result, null, 2).substring(0,500)}</pre>
            </div>`;
        } else if (result.screenshotPath) {
          return `
            <div class="task">
              <div class="task-header">Step ${i+1} – Screenshot</div>
              <img src="${result.screenshotPath}" class="screenshot" alt="Step ${i+1} Screenshot"/>
              ${result.summary ? `<p>${result.summary.substring(0,300)}…</p>` : ''}
            </div>`;
        } else {
          return `
            <div class="task">
              <div class="task-header">Step ${i+1}</div>
              <pre>${JSON.stringify(result, null, 2).substring(0,500)}</pre>
            </div>`;
        }
      }).join('')}
      ${screenshotPath
        ? `<h2>Final State</h2><img src="${screenshotPath}" class="screenshot" alt="Final Screenshot"/>`
        : ''}
    </div>
  </div>
</body>
</html>`.trim();

  // Ensure the report directory exists
  if (!fs.existsSync(reportDir)) {
    fs.mkdirSync(reportDir, { recursive: true });
  }

  // Write out the file
  const filename = `landing-report-${Date.now()}.html`;
  const outPath  = path.join(reportDir, filename);
  fs.writeFileSync(outPath, reportHTML, 'utf8');
  console.log(`[LandingReport] Saved landing report to ${outPath}`);

  return outPath;
}
