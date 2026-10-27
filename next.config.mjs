/** @type {import('next').NextConfig} */

// Static response headers for every route. Camera, microphone and screen share
// are allowed for this site and for Daily's video iframe (the interview room);
// everything else stays off. X-Robots-Tag keeps candidate links out of search.
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value:
      'camera=(self "https://*.daily.co"), microphone=(self "https://*.daily.co"), ' +
      'display-capture=(self "https://*.daily.co"), geolocation=()',
  },
  { key: "Strict-Transport-Security", value: "max-age=31536000" },
  { key: "X-Robots-Tag", value: "noindex, nofollow" },
];

const nextConfig = {
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
