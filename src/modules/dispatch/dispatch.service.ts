import { Injectable, BadGatewayException, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class DispatchService {
  constructor(private readonly configService: ConfigService) {}

  private getBaseUrl(): string {
    const baseUrl = this.configService.get<string>('DISIS_MONOLITH_URL');
    if (!baseUrl) {
      throw new ServiceUnavailableException('DISIS_MONOLITH_URL no configurado');
    }
    return baseUrl.replace(/\/$/, '');
  }

  async proxyPost(
    path: string,
    body: Record<string, unknown>,
    headers?: Record<string, string | undefined>,
  ): Promise<unknown> {
    const response = await fetch(`${this.getBaseUrl()}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(headers ?? {}),
      },
      body: JSON.stringify(body),
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new BadGatewayException(
        (payload as { error?: string })?.error ?? 'Error en servicio de dispatch',
      );
    }
    return payload;
  }
}
