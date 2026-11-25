/**
 * Textos legales INICIALES de la tienda (borrador). Se editan en /admin → Configuración → Textos legales
 * y se guardan en Supabase (store_settings, fila 'legal'). Mientras KOVA no los revise, la página
 * condiciones.html muestra un aviso de "pendiente de revisión".
 *
 * Basados en el Estatuto del Consumidor (Ley 1480 de 2011, arts. 7, 8, 46-51), el Decreto 1074 de 2015
 * y la Ley 1581 de 2012 de protección de datos personales. NO son asesoría legal: revísalos con un abogado
 * y completa los datos entre [corchetes].
 */
export const legalDefaults = {
  reviewed: false,
  sections: [
    {
      id: 'compra',
      title: 'Condiciones de compra',
      body: `KOVA STREETWEAR ([razón social o nombre del titular], NIT/C.C. [número], [ciudad], Colombia) vende a través de este sitio camisetas y productos de su marca.
Al registrar un pedido recibes un número y un enlace privado de seguimiento. Un pedido registrado es una SOLICITUD: queda confirmado solo cuando KOVA verifica el pago requerido.
Los precios están en pesos colombianos (COP) e incluyen los impuestos aplicables. El costo de envío se informa antes de pagar o se cotiza por WhatsApp cuando así se indica.
Los pagos se hacen por transferencia a los datos que se muestran en el checkout. Sube el comprobante desde tu enlace de seguimiento; KOVA lo revisa manualmente.
Si un pedido sin pago supera el plazo indicado, se vence automáticamente y las unidades se liberan.`,
    },
    {
      id: 'preventa',
      title: 'Preventas (pre-order)',
      body: `Los productos en preventa se fabrican después de cerrar la reserva. No están listos para despacho inmediato.
Puedes reservar con el anticipo indicado en cada campaña o pagar el 100%. El saldo debe pagarse antes del despacho; KOVA te avisará por WhatsApp cuando el pedido esté listo.
Las fechas de despacho y entrega son estimadas. Si KOVA no puede cumplir la fecha informada, te avisará y podrás elegir entre esperar o la devolución del dinero pagado.
Si KOVA cancela una preventa, devuelve el 100% de lo pagado. Si el cliente desiste de una reserva confirmada, aplican las reglas de retracto y cancelación de esta página.`,
    },
    {
      id: 'envios',
      title: 'Envíos y entregas',
      body: `Enviamos a todo Colombia con transportadora. El tiempo de entrega depende de la ciudad de destino y se informa al despachar, junto con el número de guía.
Revisa el paquete al recibirlo. Si llega abierto o dañado, déjalo anotado en la guía y escríbenos por WhatsApp el mismo día.`,
    },
    {
      id: 'garantia',
      title: 'Garantía',
      body: `Todos los productos tienen garantía legal por defectos de fabricación (Ley 1480 de 2011, art. 7 y 8) durante [plazo, p. ej. 3 meses] desde la entrega.
La garantía no cubre el desgaste normal, el lavado o planchado contrario a las instrucciones de la etiqueta ni daños causados por el uso.
Para hacerla efectiva escríbenos por WhatsApp con tu número de pedido y fotos del defecto: repararemos, cambiaremos el producto o devolveremos el dinero según corresponda.`,
    },
    {
      id: 'retracto',
      title: 'Derecho de retracto',
      body: `En compras a distancia puedes retractarte dentro de los 5 días hábiles siguientes a la entrega del producto (Ley 1480 de 2011, art. 47), devolviéndolo en el mismo estado en que lo recibiste, sin uso y con sus etiquetas. Los costos de transporte de la devolución corren por tu cuenta.
El retracto NO aplica a productos confeccionados según las especificaciones del consumidor o claramente personalizados (KOVA CUSTOM).
KOVA devuelve el dinero dentro de los 30 días calendario siguientes al ejercicio del retracto.`,
    },
    {
      id: 'cancelacion',
      title: 'Cancelaciones y reembolsos',
      body: `Puedes cancelar un pedido sin costo mientras no hayas pagado. Los pedidos sin pago se cancelan solos al vencer su plazo.
Si cancelas una reserva ya pagada antes de que entre en producción, KOVA reembolsa lo pagado [menos los costos de transacción, si aplican].
Una vez en producción, una preventa solo se cancela por incumplimiento de KOVA o en los casos que prevé la ley.
Los reembolsos se hacen por transferencia a la cuenta que indiques. Si usaste un código promocional y el pedido ya estaba confirmado, el uso del código no se restaura salvo que KOVA lo indique.`,
    },
    {
      id: 'datos',
      title: 'Tratamiento de datos personales',
      body: `KOVA es responsable del tratamiento de tus datos (Ley 1581 de 2012). Usamos tu nombre, WhatsApp, correo y dirección solo para gestionar tu pedido, el pago, el envío, la garantía y para contactarte sobre él.
No vendemos ni compartimos tus datos, salvo con la transportadora para entregar tu pedido.
Puedes conocer, actualizar, rectificar o pedir la supresión de tus datos escribiendo a [correo de contacto] o al WhatsApp de KOVA.
Los comprobantes de pago se guardan en un almacenamiento privado al que solo accede el equipo de KOVA.`,
    },
  ],
};
