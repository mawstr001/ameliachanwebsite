module.exports = {
  apps: [{
    name: 'amelia-chan',
    script: 'server.js',
    restart_delay: 3000,
    max_restarts: 10,
    env: {
      NODE_ENV: 'production',
      PORT: 3000,
      DATA_DIR: '/opt/data',
      ADMIN_PASSWORD: 'change-this-password'
    }
  }]
};
