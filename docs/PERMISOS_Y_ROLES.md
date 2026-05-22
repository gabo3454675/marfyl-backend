# Permisos y roles – Disis Facturación

## Roles (tabla `Member.role` / Prisma enum `Role`)

| Rol          | Descripción breve                         | Quién puede asignarlo                    |
|-------------|-------------------------------------------|------------------------------------------|
| SUPER_ADMIN | Acceso total; puede ver todas las orgs.   | Solo otro SUPER_ADMIN (o seed).          |
| ADMIN       | Gestiona usuarios y configuración de org.| SUPER_ADMIN.                             |
| MANAGER     | Inventario, ventas, asignar tareas.       | SUPER_ADMIN, ADMIN.                       |
| SELLER      | Ventas (POS, facturas, clientes).         | SUPER_ADMIN, ADMIN, MANAGER.             |
| WAREHOUSE   | Inventario y operativa.                   | SUPER_ADMIN, ADMIN, MANAGER.             |

## Quién puede crear/invitar usuarios

- **Invitar por link (POST /invitations)** e **invitaciones pendientes**:  
  Solo usuarios con **canManageUsers** = SUPER_ADMIN o ADMIN (en esa organización).
- **Provisionar miembro directo (POST /invitations/provision)** (sin email):  
  Misma regla: SUPER_ADMIN o ADMIN.
- **Super Admin sin membresía**:  
  Un usuario con `User.isSuperAdmin = true` puede invitar y provisionar en **cualquier** organización aunque no tenga fila en `Member` para esa org.

## Restricciones al asignar roles

- **ADMIN** no puede:
  - Crear ni invitar a otro **ADMIN**.
  - Crear ni invitar a **SUPER_ADMIN**.
- Solo un **SUPER_ADMIN** puede asignar rol ADMIN o SUPER_ADMIN.
- Cambio de rol de un miembro existente (PATCH members/:id/role): mismas reglas; además, un ADMIN no puede promover a nadie a SUPER_ADMIN ni a ADMIN.

## Desactivar / eliminar miembros

- **ADMIN** puede desactivar a MANAGER, SELLER, WAREHOUSE; **no** puede desactivar a un **SUPER_ADMIN**.
- Solo un **SUPER_ADMIN** puede desactivar a otro SUPER_ADMIN (`canDeleteSuperAdmin`).

## Super Admin y multi-tenant

- **Acceso a organizaciones**: Si `User.isSuperAdmin === true`, el usuario puede acceder a **cualquier** organización (el `OrganizationGuard` lo permite aunque no tenga `Member` en esa org).
- **Switcher en el front**: Para Super Admin se llama a `GET /tenants/organizations-all` y se muestra la lista de todas las orgs; al cambiar, se guarda `organizationId` y se recarga la app para cargar datos de la org seleccionada.
- **Caché**: Las respuestas cacheadas (dashboard, etc.) se keyean por URL + tenant, de modo que al cambiar de org no se devuelven datos de otra.

## Resumen de permisos por rol (`getPermissions`)

| Permiso                     | SUPER_ADMIN | ADMIN | MANAGER | SELLER | WAREHOUSE |
|----------------------------|-------------|-------|---------|--------|-----------|
| canManageUsers             | ✓           | ✓     | ✗       | ✗      | ✗         |
| canEditOrganizationSettings| ✓           | ✓     | ✗       | ✗      | ✗         |
| canManageInventory         | ✓           | ✓     | ✓       | ✗      | ✓         |
| canManageSales             | ✓           | ✓     | ✓       | ✓      | ✗         |
| canAssignTasks             | ✓           | ✓     | ✓       | ✗      | ✗         |
| canViewMembers             | ✓           | ✓     | ✓       | ✗      | ✗         |
| canCreateOrganization      | ✓           | ✗     | ✗       | ✗      | ✗         |
| canDeleteSuperAdmin        | ✓           | ✗     | ✗       | ✗      | ✗         |

Referencia de código: `apps/server/src/common/constants/roles.constants.ts`.

---

## Flujos de trabajo típicos

1. **Super Admin entra a una org donde no es miembro**  
   Selecciona la org en el switcher → recarga → el backend (OrganizationGuard) permite acceso y usa rol SUPER_ADMIN sintético → el front usa la misma lista de orgs para calcular el rol en `usePermission`, así Configuración, invitar, etc. funcionan igual.

2. **Invitar a un nuevo usuario**  
   Solo SUPER_ADMIN o ADMIN en esa org. En Configuración → equipo, "Invitar miembro"; el backend valida canManageUsers y que ADMIN no asigne ADMIN ni SUPER_ADMIN.

3. **Cambiar rol de un miembro**  
   Solo SUPER_ADMIN o ADMIN; ADMIN no puede subir a nadie a ADMIN ni SUPER_ADMIN. El front muestra el selector de rol solo si `canManageTeam`; el backend (tenants.service + RolesGuard) aplica las mismas reglas.

4. **Desactivar un miembro**  
   SUPER_ADMIN o ADMIN. Si el miembro es SUPER_ADMIN, solo otro SUPER_ADMIN puede desactivarlo (canDeleteSuperAdmin).

5. **Quién ve qué en la lista de miembros**  
   SUPER_ADMIN/ADMIN ven todos; MANAGER solo SELLER y WAREHOUSE (lógica en `getMembers` del backend). El menú "Configuración" solo se muestra si `canManageTeam` (SUPER_ADMIN o ADMIN en el front).

---

## Frontend: alineación con el backend

- **Hook `usePermission`** (`apps/client/src/hooks/usePermission.ts`):  
  Calcula el rol de la **organización actual** usando la misma fuente que el switcher: para Super Admin usa `superAdminOrganizations` (con rol SUPER_ADMIN), para el resto `user.organizations` o `user.companies`. Así, al ver una org donde no eres miembro (solo Super Admin), el menú y los botones siguen siendo coherentes con el backend.

- **Permisos expuestos en el front** (mapeo con backend):
  - `canManageTeam` → canManageUsers (Configuración, equipo, invitar, roles).
  - `canInviteMembers` → canManageUsers.
  - `canAssignTasks` → canAssignTasks (asignar tareas a otros).
  - `canManageProducts` → canManageInventory.
  - `canManageCustomers` → canManageSales (en contexto ventas/clientes).
  - `canManageExpenses` → gastos (backend: quien puede gestionar gastos).
  - `canManageSettings` → canEditOrganizationSettings (tasa BCV, etc.).

- **Menú lateral**: cada ítem usa un permiso (`permission` en `navigationItems`). Configuración usa `canManageTeam`; el sidebar ya permite SUPER_ADMIN y ADMIN explícitamente para esa ruta. El resto de rutas (POS, Inventario, Clientes, Facturas, etc.) se filtran por el permiso correspondiente.

- **Regla**: Toda comprobación de permiso en el front es para UX (ocultar/deshabilitar). El backend **siempre** valida con Guards y servicios; no confiar solo en el front.
