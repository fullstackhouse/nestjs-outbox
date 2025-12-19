import { ArgumentsHost } from '@nestjs/common';
import { HttpArgumentsHost, RpcArgumentsHost, WsArgumentsHost } from '@nestjs/common/interfaces';
import { OutboxEventContext } from '../middleware/outbox-middleware.interface';

export const OUTBOX_CONTEXT_TYPE = 'outbox' as const;

export interface OutboxArgumentsHost {
  getContext(): OutboxEventContext;
}

export class OutboxHost implements ArgumentsHost {
  private readonly args: [OutboxEventContext];

  constructor(context: OutboxEventContext) {
    this.args = [context];
  }

  getArgs<T extends any[] = any[]>(): T {
    return this.args as unknown as T;
  }

  getArgByIndex<T = any>(index: number): T {
    return this.args[index] as T;
  }

  switchToRpc(): RpcArgumentsHost {
    throw new Error('Cannot switch to RPC context from outbox context');
  }

  switchToHttp(): HttpArgumentsHost {
    throw new Error('Cannot switch to HTTP context from outbox context');
  }

  switchToWs(): WsArgumentsHost {
    throw new Error('Cannot switch to WebSocket context from outbox context');
  }

  getType<T extends string = string>(): T {
    return OUTBOX_CONTEXT_TYPE as T;
  }

  switchToOutbox(): OutboxArgumentsHost {
    return {
      getContext: () => this.args[0],
    };
  }
}

export function isOutboxContext(host: ArgumentsHost): host is OutboxHost {
  return (host.getType() as string) === OUTBOX_CONTEXT_TYPE;
}
