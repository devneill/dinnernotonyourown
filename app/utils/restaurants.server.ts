import { cachified, lruCache } from '#app/utils/cache.server'
import { prisma } from '#app/utils/db.server'
import { getNearbyRestaurants } from '#app/utils/providers/google-places.server'

// Constants
const CACHE_TTL = 1000 * 60 * 60 * 24 // 24 hours
const DEFAULT_RADIUS = 1600 // 1 mile in meters

// Types
export type RestaurantWithDetails = {
  id: string
  name: string
  priceLevel: number | null
  rating: number | null
  lat: number
  lng: number
  photoRef: string | null
  mapsUrl: string | null
  distance: number // in miles
  attendeeCount: number
  isUserAttending: boolean
}

/**
 * Calculates the distance between two points in miles
 */
function calculateDistance(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  // Haversine formula
  const R = 3958.8 // Earth's radius in miles
  const dLat = (lat2 - lat1) * (Math.PI / 180)
  const dLng = (lng2 - lng1) * (Math.PI / 180)
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * (Math.PI / 180)) *
      Math.cos(lat2 * (Math.PI / 180)) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2)
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  const distance = R * c
  return Math.round(distance * 10) / 10 // Round to 1 decimal place
}

/**
 * Fetches restaurants from Google Places API and caches them in the database
 */
async function fetchAndCacheRestaurants(lat: number, lng: number, radius: number) {
  const restaurants = await getNearbyRestaurants({ lat, lng, radius })

  // Upsert restaurants in parallel
  await Promise.all(
    restaurants.map(restaurant =>
      prisma.restaurant.upsert({
        where: { id: restaurant.id },
        create: restaurant,
        update: {
          ...restaurant,
          updatedAt: new Date(),
        },
      }),
    ),
  )

  return restaurants
}

/**
 * Gets all restaurants from the database
 */
async function getRestaurantsFromDB() {
  return prisma.restaurant.findMany()
}

/**
 * Gets all restaurants with attendance counts
 */
async function getRestaurantsWithAttendance(userId: string) {
  const restaurants = await prisma.restaurant.findMany({
    include: {
      dinnerGroup: {
        include: {
          attendees: true,
        },
      },
    },
  })

  return restaurants.map(restaurant => {
    const attendeeCount = restaurant.dinnerGroup?.attendees.length ?? 0
    const isUserAttending = restaurant.dinnerGroup?.attendees.some(
      attendee => attendee.userId === userId,
    ) ?? false

    return {
      ...restaurant,
      attendeeCount,
      isUserAttending,
    }
  })
}

/**
 * Gets the restaurant the user is attending
 */
export async function getUserAttendingRestaurant(userId: string) {
  const attendee = await prisma.attendee.findUnique({
    where: { userId },
    include: {
      dinnerGroup: {
        include: {
          restaurant: true,
        },
      },
    },
  })

  return attendee?.dinnerGroup.restaurant || null
}

/**
 * Gets all restaurant details with attendance information
 */
export async function getAllRestaurantDetails({
  userId,
  userLat,
  userLng,
  radius = DEFAULT_RADIUS,
}: {
  userId: string
  userLat: number
  userLng: number
  radius?: number
}): Promise<RestaurantWithDetails[]> {
  // Cache the API call to Google Places
  const restaurants = await cachified({
    key: `restaurants-${userLat}-${userLng}-${radius}`,
    cache: lruCache,
    ttl: CACHE_TTL,
    getFreshValue: async () => {
      return fetchAndCacheRestaurants(userLat, userLng, radius)
    },
    checkValue: (value: unknown) => Array.isArray(value),
  })

  // Get attendance data (not cached, must be real-time)
  const restaurantsWithAttendance = await getRestaurantsWithAttendance(userId)

  // Combine the data
  return restaurantsWithAttendance.map(restaurant => {
    return {
      ...restaurant,
      distance: calculateDistance(
        userLat,
        userLng,
        restaurant.lat,
        restaurant.lng,
      ),
    }
  })
}

/**
 * Joins a dinner group for a restaurant
 */
export async function joinDinnerGroup({
  userId,
  restaurantId,
}: {
  userId: string
  restaurantId: string
}) {
  // First, leave any existing dinner group
  await leaveDinnerGroup({ userId })

  // Then, get or create the dinner group for this restaurant
  const dinnerGroup = await prisma.dinnerGroup.upsert({
    where: { restaurantId },
    create: { restaurantId },
    update: {},
  })

  // Finally, create the attendee
  return prisma.attendee.create({
    data: {
      userId,
      dinnerGroupId: dinnerGroup.id,
    },
  })
}

/**
 * Leaves a dinner group
 */
export async function leaveDinnerGroup({ userId }: { userId: string }) {
  const attendee = await prisma.attendee.findUnique({
    where: { userId },
    include: {
      dinnerGroup: true,
    },
  })

  if (!attendee) return null

  // Delete the attendee
  await prisma.attendee.delete({
    where: { id: attendee.id },
  })

  // If this was the last attendee, delete the dinner group
  const remainingAttendees = await prisma.attendee.count({
    where: { dinnerGroupId: attendee.dinnerGroup.id },
  })

  if (remainingAttendees === 0) {
    await prisma.dinnerGroup.delete({
      where: { id: attendee.dinnerGroup.id },
    })
  }

  return attendee
} 