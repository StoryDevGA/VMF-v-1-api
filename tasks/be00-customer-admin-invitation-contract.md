# BE-00 Contract: Customer Admin Invitation

## Endpoint

- `POST /api/v1/customers/:customerId/admin-invitations`

## Auth and Limits

- Requires `SUPER_ADMIN` platform role.
- Uses existing `tenantManagementRateLimit`.

## Request Schema

```json
{
  "recipientEmail": "new.admin@acme.example",
  "recipientName": "New Admin"
}
```

Validation:

- `recipientEmail`: required, valid email, max 255 chars.
- `recipientName`: required, non-empty, max 255 chars.

## Success Responses

### 201 Created

New invitation created and email send attempted successfully.

```json
{
  "data": {
    "message": "Customer admin invitation created.",
    "invitation": {
      "outcome": "created",
      "invitationId": "a07f1f77bcf86cd7994390aa",
      "status": "sent",
      "visibility": "immediate"
    }
  },
  "meta": {
    "requestId": "req_123",
    "version": "v1"
  }
}
```

In dev/mock mode (`fakeAuthAllowed=true`), response includes top-level `authLink`.

### 200 OK

Active invitation already existed and was linked to this customer.

- `data.invitation.outcome = "linked_existing"`
- In dev/mock mode (`fakeAuthAllowed=true`), response includes top-level `authLink`.

### 202 Accepted

Invitation persisted but email dispatch failed.

- `data.invitation.outcome = "send_failed"`
- `data.invitation.status = "send_failed"`
- In dev/mock mode (`fakeAuthAllowed=true`), response includes top-level `authLink`.

## Error Responses

### 404 Not Found

```json
{
  "error": {
    "code": "NOT_FOUND",
    "message": "Customer not found.",
    "requestId": "req_123"
  }
}
```

### 409 Conflict

Active invitation already exists for same email in another customer.

```json
{
  "error": {
    "code": "INVITATION_ALREADY_ACTIVE",
    "message": "An active invitation already exists for this email address in another customer.",
    "details": {
      "recipientEmail": "new.admin@acme.example",
      "linkedCustomerId": "607f1f77bcf86cd799439088",
      "targetCustomerId": "607f1f77bcf86cd799439022"
    },
    "requestId": "req_123"
  }
}
```

Also returned when an active invitation is already tied to a specific user but is not yet customer-linked:

```json
{
  "error": {
    "code": "INVITATION_ALREADY_ACTIVE",
    "message": "An active invitation already exists for this email address and another user.",
    "details": {
      "recipientEmail": "new.admin@acme.example",
      "linkedUserId": "507f1f77bcf86cd799439099"
    },
    "requestId": "req_123"
  }
}
```

Stable `details.reason` enum values:

- `other-customer`
- `different-user`

### 422 Validation Failed

```json
{
  "error": {
    "code": "VALIDATION_FAILED",
    "message": "Please check the form for errors.",
    "details": {
      "recipientEmail": "recipientEmail is required"
    },
    "requestId": "req_123"
  }
}
```

## Behavioral Guarantees

- No immediate `CUSTOMER_ADMIN` role mutation.
- No canonical admin pointer update (`governance.customerAdminUserId` unchanged).
- Invitation is customer-scoped via `provisionedCustomerId`.
- Existing `POST /api/v1/customers/:customerId/admins` remains available for immediate assignment workflows.
