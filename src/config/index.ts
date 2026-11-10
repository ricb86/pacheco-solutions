export const config = {
  port: process.env.PORT || 3000,
  db: {
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || '',
    name: process.env.DB_NAME || 'extat_platform',
  },
  jwtSecret: process.env.JWT_SECRET || 'dev-secret-change-in-production',
};
