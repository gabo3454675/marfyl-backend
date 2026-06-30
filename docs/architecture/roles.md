# 👥 Roles del Sistema — MARFYL

> **Última actualización:** 2026-06-30  
> **Estado:** ✅ Implementado  
> **Versión:** 2.0.0

---

## 📋 Tabla de Contenidos

1. [Visión General](#-visión-general)
2. [Jerarquía de Roles](#-jerarquía-de-roles)
3. [Detalles por Rol](#-detalles-por-rol)
4. [Comparativa de Roles](#-comparativa-de-roles)
5. [Casos de Uso Típicos](#-casos-de-uso-típicos)
6. [Restricciones de Asignación](#-restricciones-de-asignación)
7. [Flujos de Trabajo](#-flujos-de-trabajo)

---

## 🎯 Visión General

### ¿Qué son los Roles?

Los roles en MARFYL definen el nivel de acceso y las capacidades de cada usuario dentro de una organización. Cada rol tiene un conjunto específico de permisos que determina qué acciones puede realizar.

### Principios de Diseño

| Principio | Descripción |
|-----------|-------------|
| **Menor Privilegio** | Cada rol solo tiene los permisos necesarios para su función |
| **Separación de Concerns** | Roles especializados por área de responsabilidad |
| **Escalabilidad** | Fácil de agregar nuevos roles sin romper el sistema |
| **Auditoría** | Cada acción es rastreable por rol y usuario |

---

## 🏛️ Jerarquía de Roles

```
┌─────────────────────────────────────────────────────────────────┐
│                    JERARQUÍA DE ROLES                           │
└─────────────────────────────────────────────────────────────────┘

                        ┌─────────────────┐
                        │   SUPER_ADMIN   │  ← Acceso total
                        │   (19 permisos) │
                        └────────┬────────┘
                                 │
                        ┌────────▼────────┐
                        │      ADMIN      │  ← Gestión completa
                        │   (18 permisos) │
                        └────────┬────────┘
                                 │
              ┌──────────────────┼──────────────────┐
              │                  │                  │
     ┌────────▼────────┐ ┌──────▼──────┐ ┌────────▼────────┐
     │     MANAGER     │ │   SELLER    │ │    WAREHOUSE    │
     │  (11 permisos)  │ │ (5 permisos)│ │  (3 permisos)   │
     └────────┬────────┘ └──────┬──────┘ └────────┬────────┘
              │                  │                  │
              │           ┌──────▼──────┐          │
              │           │ POS_OPERATOR│          │
              │           │ (3 permisos)│          │
              │           └─────────────┘          │
              │                                    │
     ┌────────▼────────┐                          │
     │     FISCAL      │                          │
     │  (2 permisos)   │                          │
     └─────────────────┘                          │
                                                  │
                                         ┌────────▼────────┐
                                         │    WAREHOUSE    │
                                         │  (3 permisos)   │
                                         └─────────────────┘
```

### Niveles de Acceso

| Nivel | Roles | Permisos | Alcance |
|-------|-------|----------|---------|
| **Nivel 1** | SUPER_ADMIN | 19 | Plataforma completa |
| **Nivel 2** | ADMIN | 18 | Organización completa |
| **Nivel 3** | MANAGER | 11 | Equipo + Operaciones |
| **Nivel 4** | SELLER, WAREHOUSE, POS_OPERATOR | 3-5 | Área específica |
| **Nivel 5** | FISCAL | 2 | Solo fiscal |

---

## 👤 Detalles por Rol

### 🔴 SUPER_ADMIN — Administrador de Plataforma

**Descripción:** Acceso total a todas las organizaciones y funcionalidades.

| Característica | Valor |
|----------------|-------|
| **Permisos** | 19/19 |
| **Alcance** | Todas las organizaciones |
| **Puede ser asignado por** | Solo otro SUPER_ADMIN |
| **Casos de uso** | Soporte, auditoría, gestión de plataforma |

**Permisos:**
- ✅ Acceso total a dashboard y reportes
- ✅ Gestión completa de productos e inventario
- ✅ Control total de clientes y facturas
- ✅ Anulación y eliminación de facturas
- ✅ Gestión de créditos
- ✅ Control de caja y gastos
- ✅ Gestión de equipo y configuración
- ✅ Invitación de miembros
- ✅ Asignación de tareas
- ✅ Creación de organizaciones
- ✅ Gestión fiscal

**Restricciones:**
- Ninguna (acceso total)

---

### 🟠 ADMIN — Administrador de Organización

**Descripción:** Control completo sobre su organización, excepto crear nuevas organizaciones.

| Característica | Valor |
|----------------|-------|
| **Permisos** | 18/19 |
| **Alcance** | Organización actual |
| **Puede ser asignado por** | Solo SUPER_ADMIN |
| **Casos de uso** | Gestión diaria de la organización |

**Permisos:**
- ✅ Todo lo de MANAGER
- ✅ Anulación y eliminación de facturas
- ✅ Gestión de créditos
- ✅ Gestión de equipo y configuración
- ✅ Invitación de miembros
- ✅ Gestión fiscal

**Restricciones:**
- ❌ No puede crear nuevas organizaciones
- ❌ No puede promover a SUPER_ADMIN

---

### 🟡 MANAGER — Supervisor Operativo

**Descripción:** Supervisión de ventas, inventario y tareas del equipo.

| Característica | Valor |
|----------------|-------|
| **Permisos** | 11/19 |
| **Alcance** | Operaciones y equipo |
| **Puede ser asignado por** | SUPER_ADMIN, ADMIN |
| **Casos de uso** | Supervisión diaria, asignación de tareas |

**Permisos:**
- ✅ Dashboard y reportes
- ✅ Gestión de productos e inventario
- ✅ Gestión de clientes
- ✅ Gestión de facturas (sin anular/eliminar)
- ✅ Visualización de créditos
- ✅ Gestión de caja y gastos
- ✅ Asignación de tareas

**Restricciones:**
- ❌ No puede anular/eliminar facturas
- ❌ No puede gestionar créditos
- ❌ No puede acceder a configuración avanzada
- ❌ No puede invitar miembros

---

### 🟢 SELLER — Vendedor

**Descripción:** Vendedor con acceso a ventas, clientes y cierre de caja.

| Característica | Valor |
|----------------|-------|
| **Permisos** | 5/19 |
| **Alcance** | Ventas y clientes |
| **Puede ser asignado por** | SUPER_ADMIN, ADMIN, MANAGER |
| **Casos de uso** | Registro de ventas, atención al cliente |

**Permisos:**
- ✅ Dashboard
- ✅ Gestión de clientes
- ✅ Gestión de facturas
- ✅ Visualización de créditos
- ✅ Gestión de cierre de caja

**Restricciones:**
- ❌ No puede gestionar productos/inventario
- ❌ No puede ver reportes financieros
- ❌ No puede gestionar equipo
- ❌ No puede ver gastos

---

### 🔵 WAREHOUSE — Almacenero

**Descripción:** Personal de almacén con acceso solo a inventario.

| Característica | Valor |
|----------------|-------|
| **Permisos** | 3/19 |
| **Alcance** | Inventario |
| **Puede ser asignado por** | SUPER_ADMIN, ADMIN, MANAGER |
| **Casos de uso** | Control de stock, registro de movimientos |

**Permisos:**
- ✅ Dashboard
- ✅ Gestión de productos
- ✅ Gestión de inventario

**Restricciones:**
- ❌ No puede realizar ventas
- ❌ No puede ver datos financieros
- ❌ No puede gestionar clientes
- ❌ No puede acceder a facturación

---

### ⚪ POS_OPERATOR — Operador de Caja

**Descripción:** Cajero dedicado con acceso mínimo al punto de venta.

| Característica | Valor |
|----------------|-------|
| **Permisos** | 3/19 |
| **Alcance** | Punto de venta |
| **Puede ser asignado por** | Preparado (pendiente migración) |
| **Casos de uso** | Operación de caja registradora |

**Permisos:**
- ✅ Dashboard
- ✅ Gestión de facturas (solo POS)
- ✅ Gestión de cierre de caja

**Restricciones:**
- ❌ No puede gestionar clientes
- ❌ No puede ver créditos
- ❌ No puede acceder a reportes
- ❌ No puede gestionar inventario

**Nota:** Este rol está preparado en el código pero pendiente de migración a Prisma enum.

---

### 🟣 FISCAL — Auditor Fiscal

**Descripción:** Personal de auditoría con acceso solo al módulo fiscal.

| Característica | Valor |
|----------------|-------|
| **Permisos** | 2/19 |
| **Alcance** | Módulo fiscal |
| **Puede ser asignado por** | SUPER_ADMIN, ADMIN |
| **Casos de uso** | Auditoría fiscal, compliance |

**Permisos:**
- ✅ Dashboard
- ✅ Gestión fiscal

**Restricciones:**
- ❌ No puede modificar datos
- ❌ Solo lectura del módulo fiscal
- ❌ No puede acceder a otras áreas

---

## 📊 Comparativa de Roles

### Tabla Comparativa

| Rol | Dashboard | Productos | Clientes | Facturas | Créditos | Caja | Gastos | Equipo | Config |
|-----|:---------:|:---------:|:--------:|:--------:|:--------:|:----:|:------:|:------:|:------:|
| **SUPER_ADMIN** | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| **ADMIN** | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| **MANAGER** | ✅ | ✅ | ✅ | ✅ | 👁️ | ✅ | ✅ | ❌ | ❌ |
| **SELLER** | ✅ | ❌ | ✅ | ✅ | 👁️ | ✅ | ❌ | ❌ | ❌ |
| **WAREHOUSE** | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **POS_OPERATOR** | ✅ | ❌ | ❌ | ✅ | ❌ | ✅ | ❌ | ❌ | ❌ |
| **FISCAL** | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |

**Leyenda:**
- ✅ = Acceso completo
- 👁️ = Solo visualización
- ❌ = Sin acceso

---

### SELLER vs POS_OPERATOR

| Aspecto | SELLER | POS_OPERATOR |
|---------|--------|--------------|
| **Perfil** | Vendedor completo | Cajero dedicado |
| **Gestiona clientes** | ✅ Sí | ❌ No |
| **Gestiona créditos** | ✅ Sí (ver) | ❌ No |
| **Cierre de caja** | ✅ Sí | ✅ Sí |
| **Gestión de facturas** | ✅ Sí | ✅ Sí (solo POS) |
| **Alcance** | Ventas + Clientes + Créditos | Solo punto de venta |
| **Reportes** | ❌ No | ❌ No |
| **Inventario** | ❌ No | ❌ No |

---

## 💼 Casos de Uso Típicos

### Caso 1: Tienda de Retail

```
┌─────────────────────────────────────────────────────────────────┐
│                    ORGANIZACIÓN: Tienda XYZ                     │
└─────────────────────────────────────────────────────────────────┘

Roles asignados:
├── SUPER_ADMIN → Dueño (acceso total)
├── MANAGER → Gerente de tienda
│   └── Supervisa ventas, inventario, asigna tareas
├── SELLER (×3) → Vendedores del piso
│   └── Registram ventas, gestionan clientes
├── WAREHOUSE (×1) → Almacenero
│   └── Controla stock, registra entradas/salidas
└── POS_OPERATOR (×2) → Cajeros
    └── Operan cajas registradoras
```

### Caso 2: Empresa de Servicios

```
┌─────────────────────────────────────────────────────────────────┐
│                 ORGANIZACIÓN: Servicios ABC                     │
└─────────────────────────────────────────────────────────────────┘

Roles asignados:
├── ADMIN → Director general
├── MANAGER (×2) → Gerentes de área
├── SELLER (×5) → Ejecutivos de ventas
└── FISCAL (×1) → Contador
    └── Revisa facturas y reportes fiscales
```

### Caso 3: Cadena de Tiendas

```
┌─────────────────────────────────────────────────────────────────┐
│              ORGANIZACIÓN: Cadena de Tiendas                    │
└─────────────────────────────────────────────────────────────────┘

Roles asignados:
├── SUPER_ADMIN → Corporativo
├── ADMIN (×3) → Gerentes por tienda
├── MANAGER (×6) → Supervisores
├── SELLER (×15) → Vendedores
├── WAREHOUSE (×3) → Almaceneros
└── POS_OPERATOR (×9) → Cajeros
```

---

## 🚫 Restricciones de Asignación

### Quién puede asignar qué rol

| Rol a Asignar | SUPER_ADMIN | ADMIN | MANAGER |
|----------------|:-----------:|:-----:|:-------:|
| **SUPER_ADMIN** | ✅ | ❌ | ❌ |
| **ADMIN** | ✅ | ❌ | ❌ |
| **MANAGER** | ✅ | ✅ | ❌ |
| **SELLER** | ✅ | ✅ | ✅ |
| **WAREHOUSE** | ✅ | ✅ | ✅ |
| **POS_OPERATOR** | ✅ | ✅ | ✅ |
| **FISCAL** | ✅ | ✅ | ❌ |

### Reglas de Seguridad

```
┌─────────────────────────────────────────────────────────────────┐
│                    REGLAS DE ASIGNACIÓN                         │
├─────────────────────────────────────────────────────────────────┤
│ 1. ADMIN no puede crear/invitar a otro ADMIN                    │
│ 2. ADMIN no puede crear/invitar a SUPER_ADMIN                   │
│ 3. Solo SUPER_ADMIN puede asignar rol ADMIN o SUPER_ADMIN       │
│ 4. Un usuario no puede asignar un rol superior al suyo          │
│ 5. Un ADMIN no puede promover a nadie a SUPER_ADMIN ni ADMIN    │
└─────────────────────────────────────────────────────────────────┘
```

---

## 🔄 Flujos de Trabajo

### Flujo 1: Invitación de Usuario

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   SUPER_    │     │   ADMIN     │     │   MANAGER   │
│   ADMIN     │     │             │     │             │
└──────┬──────┘     └──────┬──────┘     └──────┬──────┘
       │                   │                   │
       ▼                   ▼                   ▼
┌─────────────────────────────────────────────────────────────────┐
│                    INVITAR USUARIO                              │
├─────────────────────────────────────────────────────────────────┤
│ 1. Acceder a Configuración → Equipo                             │
│ 2. Click "Invitar miembro"                                      │
│ 3. Ingresar email y seleccionar rol                             │
│ 4. Backend valida:                                              │
│    - ¿Tiene permiso canInviteMembers?                          │
│    - ¿El rol asignado es válido?                                │
│    - ¿El rol asignado es inferior al suyo?                      │
│ 5. Se envía invitación                                          │
│ 6. Usuario acepta y se crea membership                          │
└─────────────────────────────────────────────────────────────────┘
```

### Flujo 2: Cambio de Rol

```
┌─────────────┐     ┌─────────────┐
│   Solicita  │     │   Valida    │
│   Cambio    │────►│   Backend   │
└─────────────┘     └──────┬──────┘
                           │
                    ┌──────▼──────┐
                    │   ¿Es el    │
                    │   rol válido?│
                    └──────┬──────┘
                           │
              ┌────────────┴────────────┐
              │                         │
         ┌────▼────┐              ┌─────▼─────┐
         │   SÍ    │              │    NO     │
         └────┬────┘              └─────┬─────┘
              │                         │
              ▼                         ▼
┌─────────────────────────────────────────────────────────────────┐
│                    CAMBIO APLICADO                              │
├─────────────────────────────────────────────────────────────────┤
│ - Se actualiza Member.role en la base de datos                  │
│ - Se invalida caché de permisos                                 │
│ - El usuario ve los cambios en su próxima carga                 │
└─────────────────────────────────────────────────────────────────┘
```

### Flujo 3: Desactivación de Usuario

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   Solicita  │     │   Valida    │     │   Desactiva │
│   Desactivar│────►│   Permisos  │────►│   Usuario   │
└─────────────┘     └──────┬──────┘     └──────┬──────┘
                           │                   │
                    ┌──────▼──────┐            │
                    │   ¿Puede    │            │
                    │   desactivar?│            │
                    └──────┬──────┘            │
                           │                   │
              ┌────────────┴────────────┐      │
              │                         │      │
         ┌────▼────┐              ┌─────▼─────┐│
         │   SÍ    │              │    NO     ││
         └────┬────┘              └─────┬─────┘│
              │                         │      │
              ▼                         ▼      ▼
┌─────────────────────────────────────────────────────────────────┐
│                    RESULTADO                                    │
├─────────────────────────────────────────────────────────────────┤
│ SÍ: Se desactiva el miembro, pierde acceso                     │
│ NO: Se muestra error "No tienes permisos para esta acción"     │
└─────────────────────────────────────────────────────────────────┘
```

---

## 📚 Referencias

- [Sistema de Permisos Granular](./permissions.md)
- [Modelo SaaS y roles](../MODELO-SAAS-Y-ROLES.md)
- [Permisos y roles existente](../PERMISOS_Y_ROLES.md)

---

## 📝 Changelog

| Fecha | Versión | Cambio |
|-------|---------|--------|
| 2026-06-30 | 2.0.0 | Creación del documento completo |
| 2026-06-30 | 1.0.0 | Documentación inicial |

---

**Maintenido por:** Documentation Agent  
**Última revisión:** 2026-06-30
