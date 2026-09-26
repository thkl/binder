export const environment = {
  production: true,
  apiUrl: '/api',
  // Legacy ApplicationService configuration
  host: window.location.hostname,
  path: 'api',
  api: '',
  protocol: window.location.protocol.replace(':', ''),
  apiPort: window.location.port || (window.location.protocol === 'https:' ? '443' : '80'),
  httpOptions: {},
   
};
