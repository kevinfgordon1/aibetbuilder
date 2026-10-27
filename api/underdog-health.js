const { guardCron } = require('../lib/cron-auth');
const { checkUnderdogHealth } = require('../lib/underdog-health');
const { sendProtectTelegram } = require('../lib/desk-protect-notify');

// Cron: Underdog Predict NCAAF moneyline coverage vs game_schedule and
// price drift vs Kalshi + UDX fee (lib/underdog-health.js). Alerts go to the
// existing Telegram desk channel. ?dry=1 returns the report without sending.
module.exports = async function handler(req, res) {
  if (!(await guardCron(req, res))) return;
  const dry = String((req.query && req.query.dry) || '') === '1';
  try {
    const report = await checkUnderdogHealth({ env: process.env });
    let sent = null;
    if (report.alerts.length && !dry) {
      sent = await sendProtectTelegram(`⚠️ Underdog health\n${report.alerts.join('\n')}`, { env: process.env });
    }
    res.status(200).json({ success: true, dry, alerts: report.alerts, coverage: report.coverage, drift: report.drift, sent });
  } catch (e) {
    res.status(500).json({ success: false, error: 'underdog health check failed' });
  }
};
