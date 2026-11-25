/** Nombres visibles de los estados (tienda y panel). Los estados financieros y de producción van separados. */
export const FINANCIAL = {
  pending_payment: 'Pendiente de pago',
  proof_received: 'Comprobante recibido',
  verifying: 'Verificando pago',
  deposit_confirmed: 'Anticipo confirmado',
  paid: 'Pago completo',
  rejected: 'Pago rechazado',
  partial_refund: 'Reembolso parcial',
  refunded: 'Reembolsado',
};
export const FULFILLMENT = {
  pending_confirmation: 'Pendiente de confirmación',
  confirmed: 'Reserva confirmada',
  in_production: 'En producción',
  quality_check: 'Control de calidad',
  packed: 'Empacado',
  ready: 'Listo para entrega',
  shipped: 'Enviado',
  delivered: 'Entregado',
  cancelled: 'Cancelado',
  expired: 'Reserva vencida',
};
/** Orden de la línea de tiempo del cliente. */
export const FULFILLMENT_STEPS = ['pending_confirmation', 'confirmed', 'in_production', 'quality_check', 'packed', 'shipped', 'delivered'];
/** Transiciones que el panel ofrece (las mismas que valida el servidor). */
export const FULFILLMENT_NEXT = {
  confirmed: ['in_production', 'packed', 'ready'],
  in_production: ['quality_check', 'confirmed'],
  quality_check: ['packed', 'in_production'],
  packed: ['ready', 'shipped', 'quality_check'],
  ready: ['shipped', 'delivered', 'packed'],
  shipped: ['delivered'],
};
export const KIND = { normal: 'Venta normal', preorder: 'Preventa', custom: 'KOVA Custom', mixed: 'Mixto' };
export const PAYMENT_KIND = { deposit: 'Anticipo', balance: 'Saldo', full: 'Pago completo', extra: 'Pago adicional', refund: 'Reembolso' };
export const PAYMENT_STATUS = { submitted: 'Por revisar', verifying: 'Verificando', approved: 'Aprobado', rejected: 'Rechazado' };
/** Tono visual del estado: ok | warn | bad | info. */
export const tone = (s) => ({
  paid: 'ok', deposit_confirmed: 'ok', confirmed: 'ok', delivered: 'ok', approved: 'ok', shipped: 'ok', ready: 'ok',
  rejected: 'bad', cancelled: 'bad', expired: 'bad', refunded: 'bad',
  proof_received: 'warn', verifying: 'warn', pending_payment: 'warn', pending_confirmation: 'warn', submitted: 'warn', partial_refund: 'warn',
}[s] ?? 'info');
