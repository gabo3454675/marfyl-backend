-- Datos de cobro Banco del Tesoro — Inversiones Hemenegilda S.A (Monddy)
UPDATE "concert_events"
SET
  "bankAccountName" = 'Inversiones Hemenegilda S.A',
  "bankAccountInfo" = 'Banco del Tesoro · Cuenta 010630707667073012556 · RIF J-405144823 · Tel. 0412-7572592',
  "pagoMovilInfo" = 'Pago móvil — Banco del Tesoro · Tel. 0412-7572592 · RIF J-405144823 · Titular: Inversiones Hemenegilda S.A'
WHERE "slug" = 'hemenegilda-capacidad';
