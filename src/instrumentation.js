export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
     const cron = (await import('node-cron')).default;
     const { runPushJob } = await import('./lib/worker');
     
     console.log('--- 🚀 News Pusher Scheduler Started (每分鐘檢查一次) ---');
     
     // Runs every minute
     cron.schedule('* * * * *', () => {
       console.log(`[JOB] ${new Date().toLocaleTimeString()} - Checking for new news...`);
       runPushJob().catch(err => console.error('Scheduler Job Error:', err));
     });
  }
}
