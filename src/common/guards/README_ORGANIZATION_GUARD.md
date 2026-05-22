# OrganizationGuard - Middleware de Seguridad Multi-Tenant

## Descripción

El `OrganizationGuard` es un guard de NestJS que valida y asegura el acceso multi-tenant basado en organizaciones. Este guard:

1. **Valida autenticación**: Verifica que el usuario esté autenticado (requiere `JwtAuthGuard` antes)
2. **Lee el header**: Busca `x-tenant-id` o `x-organization-id` en los headers de la petición
3. **Valida la organización**: Verifica que la organización exista en la base de datos
4. **Valida membresía**: Verifica que el usuario sea miembro activo de esa organización en la tabla `Member`
5. **Inyecta contexto**: Agrega información de la organización y membresía al objeto `Request`

## Uso Básico

### Aplicar el Guard en un Controlador

```typescript
import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '@/common/guards/jwt-auth.guard';
import { OrganizationGuard } from '@/common/guards/organization.guard';
import { ActiveOrganization } from '@/common/decorators/active-organization.decorator';

@Controller('products')
@UseGuards(JwtAuthGuard, OrganizationGuard) // IMPORTANTE: JwtAuthGuard primero
export class ProductsController {
  @Get()
  findAll(@ActiveOrganization() organizationId: number) {
    // organizationId contiene el ID de la organización validada
    // Solo se ejecuta si el usuario es miembro activo de esa organización
    return this.productsService.findAll(organizationId);
  }
}
```

### Obtener el Objeto Completo de la Organización

```typescript
import { ActiveOrganizationObject } from '@/common/decorators/active-organization-object.decorator';

@Get('info')
@UseGuards(JwtAuthGuard, OrganizationGuard)
getOrganizationInfo(@ActiveOrganizationObject() organization: Organization) {
  // organization contiene: id, nombre, slug, plan, createdAt, updatedAt
  return {
    name: organization.nombre,
    slug: organization.slug,
    plan: organization.plan,
  };
}
```

### Obtener la Membresía (Rol del Usuario)

```typescript
import { ActiveOrganizationMembership } from '@/common/decorators/active-organization-membership.decorator';

@Get('permissions')
@UseGuards(JwtAuthGuard, OrganizationGuard)
getPermissions(@ActiveOrganizationMembership() membership: Member) {
  // membership contiene: id, userId, organizationId, role, status, joinedAt
  return {
    role: membership.role, // OWNER, ADMIN, SELLER, WAREHOUSE
    status: membership.status, // ACTIVE, SUSPENDED
    canManageUsers: membership.role === 'OWNER' || membership.role === 'ADMIN',
  };
}
```

### Acceder Directamente desde el Request

```typescript
@Get('custom')
@UseGuards(JwtAuthGuard, OrganizationGuard)
customMethod(@Req() request: Request) {
  const organizationId = request.activeOrganizationId;
  const organization = request.activeOrganization;
  const membership = request.activeOrganizationMembership;
  
  // Usar la información según necesites
  return {
    orgId: organizationId,
    orgName: organization.nombre,
    userRole: membership.role,
  };
}
```

## Headers Requeridos

El guard busca el header en este orden:
1. `x-tenant-id` (preferido)
2. `x-organization-id` (alternativo)

**Ejemplo de petición HTTP:**
```http
GET /api/products HTTP/1.1
Host: localhost:3001
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
x-tenant-id: 1
```

## Errores que Puede Lanzar

- **403 Forbidden**: Usuario no autenticado
- **400 Bad Request**: Header `x-tenant-id` faltante o inválido
- **404 Not Found**: La organización no existe
- **403 Forbidden**: El usuario no es miembro activo de la organización

## Orden de Guards

**IMPORTANTE**: Siempre aplica `JwtAuthGuard` antes de `OrganizationGuard`:

```typescript
@UseGuards(JwtAuthGuard, OrganizationGuard) // ✅ Correcto
@UseGuards(OrganizationGuard, JwtAuthGuard) // ❌ Incorrecto - puede fallar
```

El `OrganizationGuard` necesita que `request.user` esté disponible, que es inyectado por `JwtAuthGuard`.

## Integración con Prisma Queries

Una vez que el guard valida la organización, puedes usar `organizationId` en tus queries:

```typescript
@Get()
@UseGuards(JwtAuthGuard, OrganizationGuard)
async findAll(@ActiveOrganization() organizationId: number) {
  // Solo productos de esta organización
  return this.prisma.product.findMany({
    where: {
      organizationId: organizationId, // Filtrado automático por tenant
    },
  });
}
```

## Notas de Seguridad

- El guard valida que el `status` de la membresía sea `'ACTIVE'`
- Si el usuario no es miembro o está suspendido, se lanza un 403
- La validación se hace en cada petición (no hay caché)
- El guard no filtra por rol: **cualquier miembro activo** (ADMIN, MANAGER, SELLER, WAREHOUSE, SUPER_ADMIN) puede acceder a los recursos de esa organización. Los permisos por endpoint se controlan con `RolesGuard` y `@Roles()` según `@/common/constants/roles.constants.ts`.

## Selector de Empresas (Frontend)

El backend devuelve en login todas las organizaciones donde el usuario es **Member** con `status: ACTIVE`, sin filtrar por rol. Por tanto, un usuario con rol **ADMIN** que pertenezca a una o más organizaciones puede ver el selector de empresas y cambiar entre ellas; no está restringido solo al "creador" ni al SUPER_ADMIN. La lista de organizaciones la construye `AuthService.validateUser()` desde la tabla `Member`.
