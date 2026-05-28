import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '@/common/prisma/prisma.service';
import * as PDFKit from 'pdfkit';

const PDFDocument = (PDFKit as any).default ?? PDFKit;

@Injectable()
export class RetencionPdfService {
  constructor(private readonly prisma: PrismaService) {}

  async generatePdfBuffer(organizationId: number, retencionId: number): Promise<Buffer> {
    const row = await this.prisma.retencionIVA.findFirst({
      where: { id: retencionId, organizationId },
      include: {
        expense: true,
        organization: { select: { nombre: true, taxId: true, legalName: true } },
      },
    });
    if (!row) throw new NotFoundException('Retencion no encontrada');

    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ margin: 50, size: 'LETTER' });
      const chunks: Buffer[] = [];
      doc.on('data', (c: Buffer) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      const orgName = row.organization.legalName ?? row.organization.nombre;
      doc.fontSize(16).text('Comprobante de Retencion de IVA', { align: 'center' });
      doc.moveDown();
      doc.fontSize(10);
      doc.text(`Agente de retencion: ${orgName}`);
      doc.text(`RIF agente: ${row.organization.taxId ?? 'N/D'}`);
      doc.text(`No. comprobante: ${row.certificateNumber ?? row.id}`);
      doc.text(`Periodo: ${row.periodMonth}/${row.periodYear}`);
      doc.moveDown();
      doc.text(`Proveedor: ${row.supplierName ?? 'N/D'}`);
      doc.text(`RIF proveedor: ${row.supplierTaxId ?? 'N/D'}`);
      doc.text(`Factura gasto #: ${row.expenseId}`);
      doc.moveDown();
      doc.text(`Base imponible: ${Number(row.baseAmount).toFixed(2)}`);
      doc.text(`IVA factura: ${Number(row.ivaAmount).toFixed(2)}`);
      doc.text(`Alicuota retencion: ${(Number(row.withholdingRate) * 100).toFixed(0)}%`);
      doc.fontSize(12).text(`Monto retenido: ${Number(row.withholdingAmount).toFixed(2)}`, {
        underline: true,
      });
      doc.moveDown(2);
      doc.fontSize(8).text('Documento generado por MARFYL — validez segun normativa SENIAT vigente.', {
        align: 'center',
      });
      doc.end();
    });
  }
}
