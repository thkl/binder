export const environment = {
  production: false,
  // Keep API calls relative in development so Angular's dev-server proxy
  // forwards them to Nest without a browser CORS request.
  apiUrl: '/api',
  // Legacy ApplicationService configuration
  host: 'localhost',
  path: 'api',
  api: '',
  protocol: 'http',
  apiPort: '3000',
  httpOptions: {},
  
};
