# Building a vertical slice

One feature, end to end. Examples use a neutral `Product` entity; substitute your own.

**Contents**

1. [The files](#the-files)
2. [Infrastructure: the endpoint](#1-infrastructure-the-endpoint)
3. [Domain: the type and the action](#2-domain-the-type-and-the-action)
4. [View: the serialization boundary](#3-view-the-serialization-boundary)
5. [View: the initial-data hook ladder](#4-view-the-initial-data-hook-ladder)
6. [View: the page component](#5-view-the-page-component)
7. [Route: tying it together](#6-route-tying-it-together)
8. [Variants](#variants)

## The files

```
src/infrastructure/endpoints/product/getProduct.ts   fetch + response schema
src/domain/product/Product.ts                        the app's type
src/domain/product/getProduct.ts                     API shape → app type
src/view/product/SerializedProduct.ts                JSON-safe form + both converters
src/view/product/providers/InitialProductProvider.tsx
src/view/product/hooks/useInitialProduct.ts
src/view/product/hooks/useProduct.ts
src/view/product/hooks/useGuaranteedProduct.ts
src/view/product/hooks/useProductIdFromSlug.ts
src/view/product/hooks/useSelectedProduct.ts
src/view/product/pages/ProductPage.tsx
src/view/product/components/*.tsx
src/pages/product/[product-slug].tsx                 the route
```

That is the full ceremony, for a page whose data is fetched at build/request time and then
kept fresh on the client. Client-only data needs far less — see [Variants](#variants).

## 1. Infrastructure: the endpoint

One function per API call. It fetches, validates the response shape, and returns raw API
data — field names exactly as the server sends them. It does not rename, reshape, or decide
anything.

```ts
// src/infrastructure/endpoints/product/getProduct.ts
import { z } from "zod";
import { httpApiClient } from "@/infrastructure/httpClients/httpApiClient";

export const getProduct = async (
  productId: string,
): Promise<GetProductResponse> => {
  const response = await httpApiClient.get(`products/${productId}`);

  const data = await response.json();

  const { error } = GetProductResponseSchema.safeParse(data);

  if (error) {
    console.error(error);
  }

  return data as GetProductResponse;
};

export const GetProductResponseSchema = z.object({
  id: z.string(),
  title: z.string(),
  image: z.string(),
  released_at: z.string().datetime({ offset: true }),
  tag: z.string().nullable(),
});

export type GetProductResponse = z.infer<typeof GetProductResponseSchema>;
```

Three things worth understanding rather than copying:

**The schema is colocated with the call.** One file answers both "how do I get a product?"
and "what does the server promise back?". A shape shared across several endpoints moves to
`infrastructure/models/` and is imported by each.

**Validation logs, it does not block.** `safeParse` plus `console.error`, not `parse`. The
reasoning, and when to use the throwing version instead, is in `errors.md`.

**The response type describes what the server sends.** `released_at`, not `releasedAt`.
Renaming here would spread the API's vocabulary into the domain under a disguise; the
translation belongs in exactly one place, and that place is the domain action.

One recurring gotcha: backends commonly send `2023-08-26T03:00:00+00`, which a strict ISO
datetime validator rejects unless you allow an offset — the usual cause of "the schema is
wrong but the app works fine".

If parsing a response gets bulky (a seat map, a deeply nested tree), extract it to
`infrastructure/endpoints-helpers/` and test it there — it is pure and easy to test.

### Authenticated endpoints

Take the token as a parameter. Infrastructure does not know how to obtain one.

```ts
export const getOrders = async (accessToken: AccessToken) => {
  const response = await httpApiClient.get("orders", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  // ...
};
```

`AccessToken` is a domain type. Importing it here is fine — infrastructure may depend on
domain _types_. Calling a domain _action_ from here would not be.

## 2. Domain: the type and the action

The type is what the rest of the app means by "product" — the app's vocabulary, and real
runtime values (`Date`, not a string).

```ts
// src/domain/product/Product.ts
export type Product = {
  id: string;
  title: string;
  imageUrl: string;
  releasedAt: Date;
  tag: string | null;
};
```

The action calls infrastructure and translates. It is the only place in the app that knows
the API calls it `image` while the app calls it `imageUrl`.

```ts
// src/domain/product/getProduct.ts
import type { Product } from "./Product";
import { getProduct as infraGetProduct } from "@/infrastructure/endpoints/product/getProduct";

export const getProduct = async (productId: string): Promise<Product> => {
  const apiProduct = await infraGetProduct(productId);

  const product: Product = {
    id: apiProduct.id,
    title: apiProduct.title,
    imageUrl: apiProduct.image,
    releasedAt: new Date(apiProduct.released_at),
    tag: apiProduct.tag,
  };

  return product;
};
```

Map fields explicitly. Spreading the API object and patching a few keys (`{...apiProduct,
imageUrl: apiProduct.image}`) drags every unmapped API field into the domain type's runtime
value, so the type says one thing and the object holds another.

When several endpoints return the same entity, put the shared parsing in
`domain/product/parseApiProducts.ts` and call it from each action. That file is also the
right home for defensive normalization — an API that returns a bare object where it
promised an array, for instance. Normalize once, comment why, and the rest of the app never
learns about it.

Actions that can fail in ways the user must be told about belong in `errors.md`.

## 3. View: the serialization boundary

Route props are serialized to JSON, so a `Date` crossing that boundary arrives as a string —
silently, with the type still claiming `Date`, which blows up on the first `.getTime()`.
Make the conversion explicit and typed.

```ts
// src/view/product/SerializedProduct.ts
import type { Product } from "@/domain/product/Product";

type OverrideProperties<
  T,
  Overrides extends Partial<Record<keyof T, unknown>>,
> = Omit<T, keyof Overrides> & Overrides;

export type SerializedProduct = OverrideProperties<
  Product,
  {
    releasedAt: string; // ISO date
  }
>;

export const serializeProduct = (product: Product): SerializedProduct => ({
  ...product,
  releasedAt: product.releasedAt.toISOString(),
});

export const deserializeProduct = (product: SerializedProduct): Product => ({
  ...product,
  releasedAt: new Date(product.releasedAt),
});
```

`OverrideProperties` is what makes this pay off: adding a field to `Product` does not
require touching `SerializedProduct`, but changing a field _to_ a `Date` breaks the build
until both converters are updated. Nested arrays override the same way, one level at a time.
(See `helpers.md` if you want the fully-typed version of that utility.)

This lives in `view/`, not `domain/` — serialization exists because of how the framework
delivers props, which is a view-layer concern. The domain should not know its types are
ever flattened.

## 4. View: the initial-data hook ladder

Five small hooks, each with one job. The goal: server-rendered data is on screen in the
first paint, the client can refetch without a flash of loading, and components deep in the
tree get a non-nullable `Product` without prop-drilling or null checks.

The only thing the ladder requires of your data layer is **a cache you can seed with
server-fetched data** — an `initialData`-style option on the query, or a cache you prime
before the first render.

```
InitialProductProvider   holds the server-fetched product (plain context, no state)
  └─ useInitialProduct   reads that context
      └─ useProduct      the cached query, seeded with it
          └─ useGuaranteedProduct   throws if absent; narrows the type
              └─ useSelectedProduct reads the route param, returns the product
```

```tsx
// src/view/product/providers/InitialProductProvider.tsx
export const InitialProductContext = createContext<Product | undefined>(
  undefined,
);

export type InitialProductProviderProps = {
  children: ReactNode;
  initialProduct: Product;
};

export const InitialProductProvider = ({
  children,
  initialProduct,
}: InitialProductProviderProps) => (
  <InitialProductContext.Provider value={initialProduct}>
    {children}
  </InitialProductContext.Provider>
);
```

```ts
// src/view/product/hooks/useInitialProduct.ts
export const useInitialProduct = () => useContext(InitialProductContext);
```

```ts
// src/view/product/hooks/useProduct.ts
export const useProduct = (productId: string) => {
  const initialProduct = useInitialProduct();

  const { data: product, status: productStatus } = useQuery({
    queryKey: ["Product", productId],
    queryFn: () => getProduct(productId),
    staleTime: 1000 * 60 * 10, // 10 minutes
    initialData: initialProduct,
  });

  return { product, productStatus };
};
```

```ts
// src/view/product/hooks/useGuaranteedProduct.ts
/**
 * Identical to useProduct, but may ONLY be called where the product is
 * already known to be loaded. Throws otherwise.
 */
export const useGuaranteedProduct = (productId: string) => {
  const value = useProduct(productId);

  if (value.product === undefined || value.productStatus !== "success") {
    throw new Error("Expected to have product in here!");
  }

  return value as {
    product: NonNullable<typeof value.product>;
    productStatus: "success";
  };
};
```

```ts
// src/view/product/hooks/useProductIdFromSlug.ts
export const useProductIdFromSlug = () => {
  const productSlug = useRouter().query["product-slug"];

  if (typeof productSlug !== "string") {
    throw new Error(
      `Expected product slug to be a string but found ${productSlug} instead!`,
    );
  }

  return productSlug;
};
```

```ts
// src/view/product/hooks/useSelectedProduct.ts
export const useSelectedProduct = () =>
  useGuaranteedProduct(useProductIdFromSlug());
```

**Why `useGuaranteedProduct` throws instead of returning `Product | undefined`.** Under a
route that server-renders its data, the product is present on the first render — always.
Encoding that as an optional type would force every consuming component into a null branch
that can never run, and those dead branches are where stale placeholder UI accumulates. The
throw states the invariant, and if the invariant ever breaks it fails loudly at the boundary
instead of rendering something subtly wrong. This trade only holds where the data really is
guaranteed; on a client-fetched route, use `useProduct` and handle the states honestly.

**Query key and staleness.** Key by entity name plus every input the query depends on. Ten
minutes is a reasonable default for content that changes slowly. Disable refetching entirely
when a refetch would break something — for example, if the domain generates client-side keys
that would be regenerated on refetch — and leave a comment saying so.

## 5. View: the page component

Composition only. It pulls data from the hooks and arranges components.

```tsx
// src/view/product/pages/ProductPage.tsx
export const ProductPage = () => {
  const { product } = useSelectedProduct();

  return (
    <>
      <NavBar />
      <ProductProfile />
      <RelatedList items={product.related} />
      <Footer />
    </>
  );
};
```

Components below it call `useSelectedProduct()` themselves rather than receiving the product
as a prop — the data is already in a cache keyed by the route param, so reading it where it
is used costs nothing and keeps intermediate components free of pass-through props.

## 6. Route: tying it together

Fetch, serialize, provide, render. Nothing else.

```tsx
// src/pages/product/[product-slug].tsx
export type ProductProps = {
  serializedProduct: SerializedProduct;
};

export default function ProductRoute({ serializedProduct }: ProductProps) {
  const product = useMemo(
    () => deserializeProduct(serializedProduct),
    [serializedProduct],
  );

  return (
    <InitialProductProvider initialProduct={product}>
      <ProductPage />
    </InitialProductProvider>
  );
}

type PageParams = { "product-slug": string };

export const getStaticPaths: GetStaticPaths<PageParams> = async () => ({
  paths: [],
  fallback: "blocking",
});

export const getStaticProps: GetStaticProps<ProductProps, PageParams> = async ({
  params,
}) => {
  if (!params) return { notFound: true };

  const product = await getProduct(params["product-slug"]);

  return {
    props: { serializedProduct: serializeProduct(product) },
    revalidate: 20 * 60,
  };
};
```

**Memoize the deserialize.** It allocates new `Date` objects; without memoization every
render produces a new object identity and defeats every downstream memo.

### Server-side guarded routes

Pages behind auth read the cookie server-side and redirect before rendering anything.

```tsx
export default function Profile() {
  return <ProfilePage />;
}

export async function getServerSideProps(context: GetServerSidePropsContext) {
  const token = serverGetAccessTokenCookie(context);

  if (token === null) {
    return { redirect: { destination: URLS.LOGIN(), permanent: false } };
  }

  return { props: {} };
}
```

Note there is no data fetching and no provider — the page's data is user-specific, fetched
client-side by hooks once the auth context exists. The route's only job is the guard.

All internal paths come from `view/routing/urls.ts` (`URLS.PRODUCT(id)`), never from string
literals, so a route rename is one edit.

## Variants

**Client-only data.** Skip `SerializedX`, the provider, `useInitialX`, and `useGuaranteedX`.
A plain query hook calling the domain action is the whole view layer, and the component
handles `pending` / `error` / `success` honestly. Most authenticated data works this way.

**Data that depends on auth.** Gate the query rather than firing it tokenless:

```ts
const { data, status, error } = useQuery({
  queryKey: ["Orders", authentication?.token],
  queryFn: () => getOrders(authentication!.token),
  enabled: !!authentication,
});
```

**Mutations.** A thin `useMutation` wrapper over the domain action, one hook per action.
Keep it thin — it exists to give the view a mutation handle, not to hold logic:

```ts
export const useLogin = () => {
  const { mutateAsync: loginMutation, error: loginError } = useMutation({
    mutationFn: (credentials: LoginCredentials) => login(credentials),
  });

  return { loginMutation, loginError };
};
```

Coordination that goes beyond calling the action — persisting a cookie, updating context,
scheduling a refresh — belongs in a feature hook (`useAuth`) that composes the mutation
hook, not inside `mutationFn`.
