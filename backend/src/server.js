import { buildServer } from './app.js';
import { config, usingDefaultSecret } from './config.js';

const { server } = buildServer();
server.listen(config.port, () => {
  console.log(`Pure Insights backend listening on http://localhost:${config.port}`);
  console.log(`WebSocket: ws://localhost:${config.port}/ws?token=<JWT>`);
  if (usingDefaultSecret) console.warn('WARNING: JWT_SECRET not set, using an insecure development default.');
});
