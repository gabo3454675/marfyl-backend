# 🔐 Sistema de Permisos Granular — MARFYL

> **Última actualización:** 2026-06-30  
> **Estado:** ✅ Implementado  
> **Versión:** 2.0.0

---

## 📋 Tabla de Contenidos

1. [Visión General](#-visión-general)
2. [Arquitectura del Sistema](#-arquitectura-del-sistema)
3. [Convenciones de Nombres](#-convenciones-de-nombres)
4. [Matriz de Permisos](#-matriz-de-permisos)
5. [Roles del Sistema](#-roles-del-sistema)
6. [Archivos Clave](#-archivos-clave)
7. [Guía de Implementación](#-guía-de-implementación)
8. [Seguridad](#-seguridad)
9. [Troubleshooting](#-troubleshooting)

---

## 🎯 Visión General

### ¿Qué es el Sistema de Permisos Granular?

El sistema de permisos granular de MARFYL es un mecanismo de control de acceso basado en roles (RBAC) que permite definir exactamente qué acciones puede realizar cada usuario dentro del sistema.

### ¿Por qué se implementó?

| Problema | Solución |
|----------|----------|
| Roles genéricos sin distinción | 7 roles específicos por función |
| Acceso total o nada | 19 permisos granulares |
| Sin auditoría de acciones | Cada permiso es explícito y rastreable |
| Difícil de extender | Sistema modular y escalable |

### Características Principales

- ✅ **19 permisos** específicos por recurso/acción
- ✅ **7 roles** predefinidos (incluyendo POS_OPERATOR preparado)
- ✅ **SUPER_ADMIN bypass** para acceso total
- ✅ **Backend + Frontend** sincronizados
- ✅ **Type-safe** con TypeScript
- ✅ **Multi-tenant** con aislamiento por organización

---

## 🏗️ Arquitectura del Sistema

```
┌─────────────────────────────────────────────────────────────────┐
│                    SISTEMA DE PERMISOS MARFYL                   │
└─────────────────────────────────────────────────────────────────┘

┌──────────────────┐    ┌──────────────────┐    ┌──────────────────┐
│   BACKEND        │    │   FRONTEND       │    │   DATABASE       │
│   (NestJS)       │    │   (Next.js)      │    │   (Prisma)       │
├──────────────────┤    ├──────────────────┤    ├──────────────────┤
│ permissions.     │◄──►│ permissions.ts   │◄──►│ Role enum        │
│ constants.ts     │    │ (PermissionMap)  │    │ (prisma.schema)  │
├──────────────────┤    ├──────────────────┤    ├──────────────────┤
│ permissions.     │    │ usePermission.ts │    │ Member.role      │
│ guard.ts         │    │ (hook)           │    │ (column)         │
├──────────────────┤    ├──────────────────┤    ├──────────────────┤
│ permissions.     │    │ app-nav.ts       │    │                  │
│ decorator.ts     │    │ (navigation)     │    │                  │
└──────────────────┘    └──────────────────┘    └──────────────────┘
         │                       │                       │
         └───────────────────────┼───────────────────────┘
                                 │
                    ┌────────────▼────────────┐
                    │   FLUJO DE VERIFICACIÓN  │
                    ├─────────────────────────┤
                    │ 1. Request HTTP          │
                    │ 2. @Permissions() deco   │
                    │ 3. PermissionsGuard      │
                    │ 4. getPermissionsForRole │
                    │ 5. Allow / Deny          │
                    └─────────────────────────┘
```

### Flujo de Verificación Backend

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   Request   │────►│   Guard     │────►│   Response  │
│   HTTP      │     │   Handler   │     │   200/403   │
└─────────────┘     └──────┬──────┘     └─────────────┘
                           │
                    ┌──────▼──────┐
                    │   Extract   │
                    │   Metadata  │
                    └──────┬──────┘
                           │
                    ┌──────▼──────┐     ┌─────────────┐
                    │   Get User  │────►│   Get Role  │
                    │   Membership│     │   from Org  │
                    └─────────────┘     └──────┬──────┘
                                               │
                    ┌──────────────────────────▼──────────────────────────┐
                    │              PERMISSION CHECK                        │
                    ├─────────────────────────────────────────────────────┤
                    │  if (role === 'SUPER_ADMIN') → ALLOW                │
                    │  else → getPermissionsForRole(role)                 │
                    │       → check required permissions                  │
                    │       → ALLOW if all present, DENY otherwise        │
                    └─────────────────────────────────────────────────────┘
```

---

## 📝 Convenciones de Nombres

### Formato de Permisos

Todos los permisos siguen el formato: `can{Acción}{Recurso}`

| Prefijo | Tipo | Ejemplo | Descripción |
|---------|------|---------|-------------|
| `canView*` | Lectura | `canViewDashboard` | Ver/leer datos |
| `canAccess*` | Navegación | `canAccessReports` | Acceder a módulo |
| `canManage*` | CRUD | `canManageProducts` | Crear, leer, actualizar, eliminar |
| `canAnulate*` | Especial | `canAnulateInvoices` | Anular (no eliminar) |
| `canDelete*` | Destructivo | `canDeleteInvoices` | Eliminar permanentemente |

### Recursos del Sistema

| Recurso | Permisos Asociados |
|---------|-------------------|
| **Dashboard** | `canViewDashboard`, `canViewFinancialCharts` |
| **Reportes** | `canViewReports` |
| **Productos** | `canManageProducts`, `canManageInventory` |
| **Clientes** | `canManageCustomers` |
| **Facturas** | `canManageInvoices`, `canAnulateInvoices`, `canDeleteInvoices` |
| **Créditos** | `canViewCredits`, `canManageCredits` |
| **Caja** | `canManageCierreCaja` |
| **Gastos** | `canManageExpenses` |
| **Equipo** | `canManageTeam`, `canManageSettings`, `canInviteMembers`, `canAssignTasks` |
| **Organización** | `canCreateOrganization` |
| **Fiscal** | `canManageFiscal` |

---

## 📊 Matriz de Permisos

### Matriz Completa: 19 Permisos × 7 Roles

| Permiso | SUPER_ADMIN | ADMIN | MANAGER | SELLER | WAREHOUSE | POS_OPERATOR | FISCAL |
|---------|:-----------:|:-----:|:-------:|:------:|:---------:|:------------:|:------:|
| `canViewDashboard` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `canViewFinancialCharts` | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| `canViewReports` | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| `canManageProducts` | ✅ | ✅ | ✅ | ❌ | ✅ | ❌ | ❌ |
| `canManageInventory` | ✅ | ✅ | ✅ | ❌ | ✅ | ❌ | ❌ |
| `canManageCustomers` | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ |
| `canManageInvoices` | ✅ | ✅ | ✅ | ✅ | ❌ | ✅ | ❌ |
| `canAnulateInvoices` | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| `canDeleteInvoices` | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| `canViewCredits` | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ |
| `canManageCredits` | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| `canManageCierreCaja` | ✅ | ✅ | ✅ | ✅ | ❌ | ✅ | ❌ |
| `canManageExpenses` | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| `canManageTeam` | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| `canManageSettings` | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| `canInviteMembers` | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| `canAssignTasks` | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| `canCreateOrganization` | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| `canManageFiscal` | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ✅ |

### Leyenda

- ✅ = Permiso otorgado
- ❌ = Permiso denegado

### Resumen por Rol

| Rol | Total Permisos | Descripción |
|-----|:--------------:|-------------|
| **SUPER_ADMIN** | 19/19 | Acceso total al sistema |
| **ADMIN** | 18/19 | Gestión completa (excepto crear org) |
| **MANAGER** | 11/19 | Ventas, inventario, reportes, tareas |
| **SELLER** | 5/19 | Ventas + clientes + créditos + cierre |
| **WAREHOUSE** | 3/19 | Solo inventario |
| **POS_OPERATOR** | 3/19 | Solo POS + cierre de caja |
| **FISCAL** | 2/19 | Solo módulo fiscal |

---

## 👥 Roles del Sistema

### 1. 🔴 SUPER_ADMIN — Acceso Total

**Descripción:** Administrador de plataforma con acceso ilimitado a todas las organizaciones.

**Permisos:** Todos (19/19)

**Casos de uso:**
- Soporte técnico de nivel superior
- Gestión de plataforma multi-tenant
- Creación de nuevas organizaciones
- Auditoría global del sistema

**Restricciones:**
- Solo puede ser asignado por otro SUPER_ADMIN
- Puede acceder a cualquier organización sin ser miembro

---

### 2. 🟠 ADMIN — Gestión Completa

**Descripción:** Administrador de organización con control total sobre su tenants.

**Permisos:** 18/19 (excepto `canCreateOrganization`)

**Casos de uso:**
- Gestión de equipo y configuración
- Administración de inventario y ventas
- Configuración de la organización
- Invitación de miembros

**Restricciones:**
- No puede crear nuevas organizaciones
- No puede promover a SUPER_ADMIN

---

### 3. 🟡 MANAGER — Supervisor Operativo

**Descripción:** Gerente con control sobre ventas, inventario y tareas.

**Permisos:** 11/19

**Casos de uso:**
- Supervisión de ventas diarias
- Gestión de inventario y productos
- Asignación de tareas al equipo
- Generación de reportes

**Restricciones:**
- No puede anular/eliminar facturas
- No puede gestionar créditos
- No puede acceder a configuración avanzada

---

### 4. 🟢 SELLER — Vendedor

**Descripción:** Vendedor con acceso a ventas, clientes y cierre de caja.

**Permisos:** 5/19

**Casos de uso:**
- Registrar ventas en POS
- Gestionar clientes
- Realizar cierre de caja
- Ver créditos pendientes

**Restricciones:**
- No puede gestionar productos/inventario
- No puede ver reportes financieros
- No puede gestionar equipo

---

### 5. 🔵 WAREHOUSE — Almacenero

**Descripción:** Personal de almacén con acceso solo a inventario.

**Permisos:** 3/19

**Casos de uso:**
- Control de stock
- Registro de entradas/salidas
- Actualización de productos

**Restricciones:**
- No puede realizar ventas
- No puede ver datos financieros
- No puede gestionar clientes

---

### 6. ⚪ POS_OPERATOR — Operador de Caja (Preparado)

**Descripción:** Cajero dedicado con acceso mínimo al punto de venta.

**Permisos:** 3/19

**Casos de uso:**
- Operar caja registradora
- Realizar ventas básicas
- Cierre de caja al final del turno

**Restricciones:**
- No puede gestionar clientes
- No puede ver créditos
- No puede acceder a reportes

**Nota:** Este rol está preparado en el código pero pendiente de migración a Prisma enum.

---

### 7. 🟣 FISCAL — Auditor Fiscal

**Descripción:** Personal de auditoría con acceso solo al módulo fiscal.

**Permisos:** 2/19

**Casos de uso:**
- Revisión de facturas fiscales
- Auditoría de compliance
- Generación de reportes fiscales

**Restricciones:**
- No puede modificar datos
- Solo lectura del módulo fiscal

---

## 📁 Archivos Clave

### Backend (NestJS + Prisma)

```
marfyl-backend/src/common/
├── constants/
│   └── permissions.constants.ts    ← Definición de permisos y roles
├── decorators/
│   └── permissions.decorator.ts    ← Decorador @Permissions()
└── guards/
    └── permissions.guard.ts        ← Guard de verificación
```

#### `permissions.constants.ts`

```typescript
// Tipo unión de todos los permisos válidos
export type PermissionKey =
  | 'canViewDashboard'
  | 'canViewFinancialCharts'
  // ... 17 permisos más

// Mapeo de roles a permisos
export const ROLE_PERMISSIONS_MAP = {
  SUPER_ADMIN: [...],
  ADMIN: [...],
  MANAGER: [...],
  SELLER: [...],
  WAREHOUSE: [...],
  POS_OPERATOR: [...],
  FISCAL: [...],
} as const;

// Funciones de utilidad
export function getPermissionsForRole(role: RoleName): ReadonlySet<PermissionKey>
export function hasPermission(role: RoleName, permission: PermissionKey): boolean
export function hasAnyPermission(role: RoleName, permissions: PermissionKey[]): boolean
export function hasAllPermissions(role: RoleName, permissions: PermissionKey[]): boolean
```

#### `permissions.decorator.ts`

```typescript
// Definir permisos requeridos para una ruta
@Permissions('canManageInvoices')
@Post()
async createInvoice() {}

// Múltiples permisos (AND lógico)
@Permissions('canViewDashboard', 'canViewReports')
@Get()
async getReports() {}
```

#### `permissions.guard.ts`

```typescript
// Flujo del guard:
// 1. Lee metadata del decorator @Permissions
// 2. Si no hay metadata → permite acceso
// 3. Obtiene rol del membership activo
// 4. Si SUPER_ADMIN → permite acceso (bypass)
// 5. Verifica TODOS los permisos requeridos
// 6. Si falta alguno → lanza ForbiddenException
```

---

### Frontend (Next.js + TypeScript)

```
marfyl-frontend/src/
├── config/
│   ├── permissions.ts    ← PermissionMap y ROLE_PERMISSIONS
│   └── app-nav.ts        ← Navegación con permisos
└── hooks/
    └── usePermission.ts  ← Hook para verificar permisos
```

#### `permissions.ts`

```typescript
// Mapa de permisos por rol
export const ROLE_PERMISSIONS: Record<string, PermissionMap> = {
  SUPER_ADMIN: {
    canViewDashboard: true,
    canManageProducts: true,
    // ...
  },
  // ...
};

// Función para obtener permisos
export function getPermissionsForRole(role: string): PermissionMap
```

#### `usePermission.ts`

```typescript
// Hook para usar en componentes
const permissions = usePermission();

// Acceder a permisos
if (permissions.canManageInvoices) {
  // Mostrar botón de facturación
}

// Identificar rol
if (permissions.isPosOperator) {
  // Mostrar interfaz simplificada
}
```

#### `app-nav.ts`

```typescript
// Navegación filtrada por permisos
export const APP_NAV_ITEMS: AppNavItem[] = [
  { id: 'pos', label: 'POS', permission: 'canManageInvoices' },
  { id: 'products', label: 'Inventario', permission: 'canManageProducts' },
  // ...
];
```

---

## 🛠️ Guía de Implementación

### Cómo Agregar un Nuevo Permiso

#### Paso 1: Backend — `permissions.constants.ts`

```typescript
// 1. Agregar al tipo PermissionKey
export type PermissionKey =
  | 'canViewDashboard'
  | 'canManageProducts'
  | 'canNewPermission';  // ← Nuevo

// 2. Agregar al array ALL_PERMISSIONS
export const ALL_PERMISSIONS: readonly PermissionKey[] = [
  'canViewDashboard',
  'canManageProducts',
  'canNewPermission',  // ← Nuevo
];

// 3. Asignar a roles en ROLE_PERMISSIONS_MAP
export const ROLE_PERMISSIONS_MAP = {
  SUPER_ADMIN: [..., 'canNewPermission'],
  ADMIN: [..., 'canNewPermission'],
  MANAGER: [...],
  // ...
};
```

#### Paso 2: Frontend — `permissions.ts`

```typescript
// 1. Agregar al tipo PermissionKey
export type PermissionKey =
  | 'canViewDashboard'
  | 'canManageProducts'
  | 'canNewPermission';  // ← Nuevo

// 2. Agregar a ROLE_PERMISSIONS
export const ROLE_PERMISSIONS: Record<string, PermissionMap> = {
  SUPER_ADMIN: {
    canViewDashboard: true,
    canManageProducts: true,
    canNewPermission: true,  // ← Nuevo
  },
  // ...
};
```

#### Paso 3: Usar en Backend

```typescript
// En un controller
@Permissions('canNewPermission')
@Get()
async getNewResource() {
  // ...
}
```

#### Paso 4: Usar en Frontend

```typescript
// En un componente
const { canNewPermission } = usePermission();

if (canNewPermission) {
  return <NewComponent />;
}
```

---

### Cómo Agregar un Nuevo Rol

#### Paso 1: Backend — `permissions.constants.ts`

```typescript
// 1. Agregar al tipo RoleName
export type RoleName =
  | 'SUPER_ADMIN'
  | 'ADMIN'
  | 'NEW_ROLE';  // ← Nuevo

// 2. Agregar a ROLE_PERMISSIONS_MAP
export const ROLE_PERMISSIONS_MAP = {
  SUPER_ADMIN: [...],
  ADMIN: [...],
  NEW_ROLE: [  // ← Nuevo
    'canViewDashboard',
    'canManageProducts',
    // Permisos específicos del rol
  ],
};
```

#### Paso 2: Frontend — `permissions.ts`

```typescript
// 1. Agregar a ROLE_PERMISSIONS
export const ROLE_PERMISSIONS: Record<string, PermissionMap> = {
  SUPER_ADMIN: {...},
  ADMIN: {...},
  NEW_ROLE: {  // ← Nuevo
    canViewDashboard: true,
    canManageProducts: true,
    // ...
  },
};
```

#### Paso 3: Frontend — `usePermission.ts`

```typescript
// Agregar identificador del rol
const isNewRole = role === 'NEW_ROLE';

return {
  ...permissions,
  isNewRole,  // ← Nuevo
};
```

#### Paso 4: Prisma Schema (cuando se migre)

```prisma
enum Role {
  SUPER_ADMIN
  ADMIN
  MANAGER
  SELLER
  WAREHOUSE
  POS_OPERATOR
  FISCAL
  NEW_ROLE  // ← Nuevo
}
```

---

## 🔒 Seguridad

### Capas de Protección

```
┌─────────────────────────────────────────────────────────────────┐
│                     CAPAS DE SEGURIDAD                          │
├─────────────────────────────────────────────────────────────────┤
│  1. Frontend                                                    │
│     └─ usePermission() oculta/deshabilita UI                   │
├─────────────────────────────────────────────────────────────────┤
│  2. Backend Guard                                               │
│     └─ PermissionsGuard verifica en cada request                │
├─────────────────────────────────────────────────────────────────┤
│  3. Service Layer                                               │
│     └─ Servicios validan permisos antes de operaciones          │
├─────────────────────────────────────────────────────────────────┤
│  4. Database                                                    │
│     └─ Row-level security por organizationId                    │
└─────────────────────────────────────────────────────────────────┘
```

### Reglas de Seguridad

| Regla | Descripción |
|-------|-------------|
| **SUPER_ADMIN Bypass** | SUPER_ADMIN bypasea todos los permisos verificados |
| **Default Deny** | Si un permiso no existe en el mapa → denegado |
| **AND Logic** | Múltiples permisos en @Permissions() requieren TODOS |
| **Frontend + Backend** | Nunca confiar solo en el frontend |
| **Membership Required** | Sin membership activa → denegado |

### Errores Comunes

```typescript
// ❌ MAL: Confiar solo en el frontend
if (permissions.canManageInvoices) {
  await deleteInvoice(id);  // Peligroso
}

// ✅ BIEN: Frontend + Backend
if (permissions.canManageInvoices) {
  await api.delete(`/invoices/${id}`);  // Backend valida también
}
```

---

## 🔍 Troubleshooting

### Problema: Usuario no puede acceder a una función

**Diagnóstico:**
```typescript
// 1. Verificar permisos en consola
const perms = usePermission();
console.log('Role:', perms.role);
console.log('canManageInvoices:', perms.canManageInvoices);

// 2. Verificar en backend
// GET /api/auth/me → verificar role en membership
```

**Soluciones:**
1. Verificar que el rol tiene el permiso en `ROLE_PERMISSIONS_MAP`
2. Verificar que la organización tiene el membership correcto
3. Verificar que el header `x-tenant-id` está presente

---

### Problema: POS_OPERATOR no aparece en el selector

**Causa:** POS_OPERATOR está preparado en código pero no en Prisma enum.

**Solución:** Ejecutar migración de Prisma para agregar el rol:
```sql
ALTER TYPE "Role" ADD VALUE 'POS_OPERATOR';
```

---

### Problema: Permisos desincronizados entre frontend y backend

**Verificación:**
```typescript
// Backend
console.log(getPermissionsForRole('SELLER'));

// Frontend
console.log(ROLE_PERMISSIONS['SELLER']);
```

**Solución:** Asegurar que ambos archivos tengan los mismos permisos para cada rol.

---

## 📚 Referencias

- [Documentación de roles](./roles.md)
- [Modelo SaaS y roles](../MODELO-SAAS-Y-ROLES.md)
- [Permisos y roles existente](../PERMISOS_Y_ROLES.md)
- [PLAN-POS-OPERATOR](../../../PLAN-POS-OPERATOR.md)

---

## 📝 Changelog

| Fecha | Versión | Cambio |
|-------|---------|--------|
| 2026-06-30 | 2.0.0 | Creación del documento con sistema completo |
| 2026-06-30 | 1.0.0 | Sistema de permisos implementado |

---

**Maintenido por:** Documentation Agent  
**Última revisión:** 2026-06-30
