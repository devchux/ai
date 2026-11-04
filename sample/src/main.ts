import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';

/** http://localhost:3000: POST /support/emails, POST /assistant/chat, and the MCP endpoint at /mcp. */
async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  await app.listen(process.env.PORT ?? 3000, '127.0.0.1');
}

void bootstrap();
