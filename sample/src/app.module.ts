import { Logger, Module } from '@nestjs/common';
import { AiModule } from '@nestjs/ai';
import { McpModule } from '@nestjs/mcp';
import { AssistantModule } from './assistant/assistant.module.js';
import { storeModels } from './models.js';
import { OrdersModule } from './orders/orders.module.js';
import { SupportModule } from './support/support.module.js';

const usage = new Logger('Usage');

@Module({
  imports: [
    AiModule.forRoot({
      // The support and assistant modules inject AiService.
      isGlobal: true,
      models: storeModels(),
      defaults: { timeout: '30s', retry: { attempts: 3 }, maxSteps: 5 },
      onUsage: (event) =>
        usage.log(`${event.label ?? 'call'} ${event.model.modelId}: ${event.usage.totalTokens} tokens, $${event.cost?.toFixed(5) ?? '?'}`),
    }),
    // find-order for the support team's MCP clients: the @Tool() methods of OrdersModule only.
    McpModule.forRoot({
      name: 'cat-store',
      version: '1.0.0',
      include: [OrdersModule],
      http: { allowedHosts: ['localhost', '127.0.0.1', '[::1]'] },
    }),
    OrdersModule,
    SupportModule,
    AssistantModule,
  ],
})
export class AppModule {}
