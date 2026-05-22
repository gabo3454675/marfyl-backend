import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NotificationsService } from './notifications.service';

const UMBRAL_FALTANTE_CIERRE = 5; // Dólares: notificar si diferencia < -5

/**
 * Envía notificaciones push a Super Admins vía Firebase Cloud Messaging.
 * Si FIREBASE_* no está configurado, no envía (no rompe el flujo).
 */
@Injectable()
export class PushNotificationService {
  private readonly logger = new Logger(PushNotificationService.name);
  private messaging: import('firebase-admin').messaging.Messaging | null = null;

  constructor(
    private readonly config: ConfigService,
    private readonly notifications: NotificationsService,
  ) {
    this.initFirebase();
  }

  private initFirebase(): void {
    const cred = this.config.get<string>('FIREBASE_SERVICE_ACCOUNT_JSON');
    if (!cred) {
      this.logger.warn('FIREBASE_SERVICE_ACCOUNT_JSON no configurado. Notificaciones push desactivadas.');
      return;
    }
    try {
      const admin = require('firebase-admin');
      let app: import('firebase-admin').app.App;
      if (!admin.apps.length) {
        const serviceAccount = JSON.parse(cred) as Record<string, string>;
        app = admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
      } else {
        app = admin.app();
      }
      this.messaging = app.messaging();
    } catch (e) {
      this.logger.warn('No se pudo inicializar Firebase Admin. Notificaciones push desactivadas.', e);
    }
  }

  /**
   * Notifica a Super Admins cuando un cierre de caja tiene diferencia negativa mayor a $5.
   */
  async notifyCierreFaltante(params: {
    organizationName: string;
    cajero: string;
    diferencia: number;
    cierreId: number;
  }): Promise<void> {
    if (params.diferencia >= -UMBRAL_FALTANTE_CIERRE) return;
    const tokens = await this.notifications.getFcmTokensForSuperAdmins();
    if (tokens.length === 0) return;
    const title = '⚠️ Cierre con faltante';
    const body = `${params.organizationName}: cierre #${params.cierreId} (${params.cajero}). Faltante: $${Math.abs(params.diferencia).toFixed(2)}.`;
    await this.sendToTokens(tokens, title, body, { type: 'cierre_faltante', cierreId: String(params.cierreId) });
  }

  /**
   * Notifica a Super Admins cuando el stock de un producto baja del mínimo.
   */
  async notifyStockBajo(params: {
    organizationName: string;
    productName: string;
    productId: number;
    stockActual: number;
    minStock: number;
  }): Promise<void> {
    if (params.stockActual >= params.minStock) return;
    const tokens = await this.notifications.getFcmTokensForSuperAdmins();
    if (tokens.length === 0) return;
    const title = '📦 Stock bajo';
    const body = `${params.organizationName}: "${params.productName}" tiene ${params.stockActual} unidades (mínimo ${params.minStock}).`;
    await this.sendToTokens(tokens, title, body, { type: 'stock_bajo', productId: String(params.productId) });
  }

  private async sendToTokens(
    tokens: string[],
    title: string,
    body: string,
    data?: Record<string, string>,
  ): Promise<void> {
    if (!this.messaging) return;
    try {
      const message = {
        notification: { title, body },
        data: data ?? {},
        tokens,
        android: { priority: 'high' as const },
        apns: { payload: { aps: { sound: 'default' } } },
      };
      const res = await this.messaging.sendEachForMulticast(message);
      if (res.failureCount > 0) {
        this.logger.warn(`Push: ${res.successCount} enviados, ${res.failureCount} fallidos.`);
      }
    } catch (e) {
      this.logger.error('Error enviando notificación push', e);
    }
  }
}
