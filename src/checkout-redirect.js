// Stripe checkout retired from public Numina purchase flow.
// Keep the endpoint name for backward compatibility with existing callers.
// Never invoke a payment provider or accept card data through this route.
// Return an explicit unavailable response; customers can request an invoice.
export const CHECKOUT_PATH='/api/payments/v1/checkout';

export async function checkoutRedirect() {
  return new Response(JSON.stringify({
    error:'PAYMENT_PROVIDER_UNAVAILABLE',
    message:'Online payment is not available. Request a USD invoice through /checkout.',
    checkout_path:'/checkout'
  }), {
    status:503,
    headers:{
      'content-type':'application/json; charset=utf-8',
      'cache-control':'no-store',
      'x-content-type-options':'nosniff'
    }
  });
}
