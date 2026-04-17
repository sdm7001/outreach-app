'use strict';

// Must be set before any module loads
process.env.JWT_SECRET = 'test-jwt-secret-minimum-32-characters-long';
process.env.ADMIN_PASSWORD = 'TestAdmin1!';
process.env.DB_PATH = ':memory:';
process.env.NODE_ENV = 'test';
process.env.ANTHROPIC_API_KEY = '';
process.env.SMTP_USER = '';
process.env.SMTP_PASS = '';
