import 'module-alias/register';
import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import rateLimit from 'express-rate-limit';
import dotenv from 'dotenv';
import { connectDatabase } from '@config/database';
import { errorHandler } from '@middlewares/errorHandler';
import { logger } from '@utils/logger';
import routes from '@routes';

dotenv.config({ path: '.env' });

const app = express();
const PORT = process.env.PORT || 3001;

// Security middleware
app.use(helmet());
app.use(compression());

// Rate limiting - Configuração por ambiente
const isProduction = process.env.NODE_ENV === 'production';
const limiter = rateLimit({
  windowMs: isProduction ? 15 * 60 * 1000 : 60 * 60 * 1000, // 15min em prod, 1h em dev
  max: isProduction ? 100 : 1000, // Limites por IP
  message: {
    error: 'Too many requests from this IP, please try again later.',
    retryAfter: isProduction ? '15 minutes' : '1 hour'
  }
});

app.use('/api', limiter);

// CORS configurável via variáveis de ambiente
const allowedOrigins = process.env.CORS_ORIGIN?.split(',') || ['http://localhost:3000'];
app.use(cors({
  origin: (origin, callback) => {
    // Permitir requests sem origem (mobile apps, etc)
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json({ limit: '10kb' })); // Limite de tamanho do body

// Health check
app.get('/health', (req: Request, res: Response) => {
  res.status(200).json({ 
    status: 'ok', 
    environment: process.env.NODE_ENV || 'development',
    timestamp: new Date().toISOString() 
  });
});

// Routes
app.use(routes);

// Error handler - deve ser o último middleware
app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
  logger.error(`[${req.method}] ${req.url} - ${err.message}`);
  errorHandler(err, req, res, next);
});

// Start server
async function start() {
  try {
    await connectDatabase();
    
    app.listen(PORT, () => {
      logger.info(`🚀 Servidor rodando em http://localhost:${PORT}`);
      logger.info(`   Ambiente: ${process.env.NODE_ENV || 'development'}`);
      logger.info(`   JWT Secret configurado: ${!!process.env.JWT_SECRET}`);
    });
  } catch (error) {
    logger.error('Erro ao iniciar servidor:', error);
    process.exit(1);
  }
}

start();
