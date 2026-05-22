export class DashboardSummaryDto {
  totalSalesToday: number;
  productsCount: number;
  lowStockCount: number;
  recentTransactions: {
    id: number;
    customerName: string;
    amount: number;
    status: string;
    createdAt: Date;
  }[];
}
