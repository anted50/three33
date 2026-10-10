import { createFileRoute } from '@tanstack/react-router'
import { staffAuth } from '~/lib/server/api/middleware'
import { handle } from '~/lib/server/api/respond'

/**
 * GET /api/v1/auth/me — who is signed in
 *
 * Auth   staff (staffAuth)
 * 200    { userId, email, name, isOwner, barberId }
 *        isOwner   may use /api/v1/owner/*
 *        barberId  may use /api/v1/barber/* (null if not a barber)
 * 401    UNAUTHORIZED
 */
export const Route = createFileRoute('/api/v1/auth/me')({
  server: {
    middleware: [staffAuth],
    handlers: {
      GET: ({ context }) => handle(() => context.staff),
    },
  },
})
