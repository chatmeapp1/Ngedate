const http = require('http');
const config = require('./config');
const { createApp } = require('./app');
const realtime = require('./realtime');
const { migrate } = require('./migrate');
const { startRefundJob } = require('./jobs/refund');
const { startSalaryJob } = require('./jobs/salary');
const { startLiveJob } = require('./jobs/live');

async function main() {
  await migrate();
  const app = createApp();
  const server = http.createServer(app);
  realtime.attach(server);
  startRefundJob(config.refundJobIntervalMs);
  startSalaryJob();
  startLiveJob();
  server.listen(config.port, () => console.log(`Ngedate backend jalan di port ${config.port}`));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
