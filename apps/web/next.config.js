/* global process */
/**
 * Security headers. `connect-src` allows the browser to talk to this origin and
 * Azure Blob endpoints only. Referrer-Policy keeps URLs (and any query strings)
 * out of Referer headers.
 *
 * @type {import('next').NextConfig}
 */
const isDev = process.env.NODE_ENV !== "production";

const nextConfig = {
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          {
            key: "Content-Security-Policy",
            value: [
              `connect-src 'self' https://*.blob.core.windows.net${isDev ? " ws: http://localhost:*" : ""}`,
              "frame-ancestors 'none'",
              "base-uri 'self'",
              "form-action 'self'",
            ].join("; "),
          },
        ],
      },
    ];
  },
};

export default nextConfig;
