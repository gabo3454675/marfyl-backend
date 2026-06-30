# 📚 Arquitectura — MARFYL

> **Última actualización:** 2026-06-30  
> **Estado:** ✅ Actualizado

---

## 📋 Documentos de Arquitectura

### Sistema de Permisos

| Documento | Descripción | Estado |
|-----------|-------------|--------|
| [permissions.md](./permissions.md) | Sistema de permisos granular completo | ✅ Actualizado |
| [roles.md](./roles.md) | Roles del sistema y jerarquía | ✅ Actualizado |

### Otros Documentos

| Documento | Ubicación | Descripción |
|-----------|-----------|-------------|
| [MODELO-SAAS-Y-ROLES.md](../MODELO-SAAS-Y-ROLES.md) | docs/ | Modelo SaaS y tipos de usuario |
| [PERMISOS_Y_ROLES.md](../PERMISOS_Y_ROLES.md) | docs/ | Permisos existentes (pre-granular) |

---

## 🔐 Resumen del Sistema de Permisos

### Permisos Implementados

- **Total:** 19 permisos granulares
- **Formato:** `can{Acción}{Recurso}`
- **Ejemplo:** `canManageInvoices`, `canViewDashboard`

### Roles Implementados

- **Total:** 7 roles
- **SUPER_ADMIN:** Acceso total (19/19 permisos)
- **ADMIN:** Gestión completa (18/19 permisos)
- **MANAGER:** Supervisor operativo (11/19 permisos)
- **SELLER:** Vendedor (5/19 permisos)
- **WAREHOUSE:** Almacenero (3/19 permisos)
- **POS_OPERATOR:** Operador de caja (3/19 permisos) - Preparado
- **FISCAL:** Auditor fiscal (2/19 permisos)

### Archivos Clave

#### Backend (NestJS)

```
src/common/
├── constants/permissions.constants.ts
├── decorators/permissions.decorator.ts
└── guards/permissions.guard.ts
```

#### Frontend (Next.js)

```
src/
├── config/permissions.ts
├── config/app-nav.ts
└── hooks/usePermission.ts
```

---

## 📖 Cómo Usar Esta Documentación

### Para Desarrolladores Backend

1. Revisar `permissions.md` para entender el sistema
2. Usar `@Permissions()` decorator en controllers
3. El `PermissionsGuard` verifica automáticamente

### Para Desarrolladores Frontend

1. Usar `usePermission()` hook en componentes
2. Verificar permisos antes de mostrar UI
3. La navegación filtra automáticamente por permisos

### Para Administradores

1. Revisar `roles.md` para entender los roles
2. Asignar roles según la función del usuario
3. Los permisos se heredan del rol

---

## 🔄 Mantenimiento

### Agregar Nuevo Permiso

Ver `permissions.md` → Guía de Implementación

### Agregar Nuevo Rol

Ver `roles.md` → Detalles por Rol

### Solucionar Problemas

Ver `permissions.md` → Troubleshooting

---

**Maintenido por:** Documentation Agent  
**Última revisión:** 2026-06-30
