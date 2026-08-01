# Helpers

The generic utilities the other reference files use. Nothing here is architectural — it is
plumbing that makes the patterns pleasant. Each entry gives the minimal version first, then
the fully-typed one you can paste as-is, then the published package if you would rather
install it.

**Contents**

1. [`retex` — a typed selective catch](#1-retex--a-typed-selective-catch)
2. [`createErrorClass` — errors with a typed reason](#2-createerrorclass--errors-with-a-typed-reason)
3. [Type utilities](#3-type-utilities)

## 1. `retex` — a typed selective catch

**Minimal version.** Written inline, this is all it does:

```ts
let data: Data;

try {
  data = await someCall();
} catch (error) {
  if (!isHttpError(error)) throw error; // unexpected — not ours to absorb

  return handle(error); // error is HttpError here
}
```

**Typed version.** `returnException` wraps a function so it returns `[value, undefined]` or
`[undefined, error]`, with the error typed by the predicates you pass; `retex` is the same
thing for a call you make immediately. Anything no predicate matches is rethrown. Works for
sync and async functions alike.

```ts
// src/utils/returnException.ts
type TypePredicate<T> = (value: unknown) => value is T;

type TypePredicateConstraint = TypePredicate<unknown>;

type ExtractTypeFromTypePredicate<T extends TypePredicateConstraint> =
  T extends (value: unknown) => value is infer U ? U : never;

const isPromise = <T>(object: unknown): object is Promise<T> =>
  typeof object === "object" &&
  object !== null &&
  "then" in object &&
  typeof object.then === "function";

type ReturnExceptionReturnValue<ReturnValue, Exception> =
  ReturnValue extends Promise<unknown>
    ? Promise<[Awaited<ReturnValue>, undefined] | [undefined, Exception]>
    : [ReturnValue, undefined] | [undefined, Exception];

export const returnException =
  <
    Args extends Array<unknown>,
    ReturnValue,
    Checkers extends Array<(value: unknown) => value is {}>,
  >(
    fn: (...args: Args) => ReturnValue,
    checkers?: Checkers,
  ) =>
  (
    ...args: Args
  ): ReturnExceptionReturnValue<
    ReturnValue,
    ExtractTypeFromTypePredicate<Checkers[number]>
  > => {
    type Return = ReturnExceptionReturnValue<
      ReturnValue,
      ExtractTypeFromTypePredicate<Checkers[number]>
    >;

    try {
      const result = fn(...args);

      if (isPromise<ReturnValue>(result)) {
        return result
          .then((value) => [value, undefined])
          .catch((error) => {
            if (!checkers) {
              return [undefined, error];
            }

            if (checkers.every((checker) => !checker(error))) {
              throw error;
            }

            return [undefined, error];
          }) as Return;
      }

      return [result, undefined] as Return;
    } catch (error) {
      if (!checkers) {
        return [undefined, error] as Return;
      }

      if (checkers.every((checker) => !checker(error))) {
        throw error;
      }

      return [undefined, error] as Return;
    }
  };

export const retex = <
  ReturnValue,
  Checkers extends Array<(value: unknown) => value is {}>,
>(
  fn: () => ReturnValue,
  checkers?: Checkers,
): ReturnExceptionReturnValue<
  ReturnValue,
  ExtractTypeFromTypePredicate<Checkers[number]>
> => {
  return returnException(fn, checkers)();
};
```

Published as `return-exception`. Note that omitting the predicates entirely makes it catch
everything — which is the behavior the discipline in `errors.md` exists to avoid, so always
pass the list.

## 2. `createErrorClass` — errors with a typed reason

**Minimal version.** One class per domain operation, hand-written:

```ts
export type LoginErrorReason =
  | "WrongPassword"
  | "UsernameDoesNotExist"
  | "UnexpectedError";

export class LoginError extends Error {
  public readonly reason: LoginErrorReason;

  constructor(
    message: string,
    options: { reason: LoginErrorReason; cause?: Error },
  ) {
    super(message, { cause: options.cause });
    this.name = "LoginError";
    this.reason = options.reason;
  }
}

export const isLoginError = (error: unknown): error is LoginError =>
  error instanceof LoginError;
```

**Typed version.** The factory generates the class and its guard from a map of reasons, and
adds a per-reason `context` payload:

```ts
// src/utils/createErrorClass.ts
export const createErrorClass =
  <ReasonContextMap extends Record<string, unknown>>() =>
  <ClassName extends string>(className: ClassName) => {
    type Reason = keyof ReasonContextMap;

    type AdditionalInfo<SpecificReason extends Reason> = {
      reason: SpecificReason;
      cause?: Error;
    } & (ReasonContextMap[SpecificReason] extends undefined
      ? {}
      : {
          context: ReasonContextMap[SpecificReason];
        });

    const ErrorClass = class<SpecificReason extends Reason> extends Error {
      constructor(
        message: string,
        additionalInfo: AdditionalInfo<SpecificReason>,
      ) {
        super(message, {
          cause: additionalInfo.cause,
        });

        this.reason = additionalInfo.reason;
        this.context = (
          additionalInfo as {
            context: ReasonContextMap[SpecificReason];
          }
        ).context;
      }

      public readonly reason: SpecificReason;
      public readonly context: ReasonContextMap[SpecificReason];
    };

    // As a class (which is actually just a function) name is readonly,
    // we need to use definedProperty in order to set it
    Object.defineProperty(ErrorClass, "name", { value: className });

    // We need to use this trick for the type predicate
    // to work correctly
    type UnionToDiscriminatedUnion<SpecificReason extends Reason> =
      SpecificReason extends string
        ? {
            reason: SpecificReason;
            context: ReasonContextMap[SpecificReason];
          }
        : never;

    type ErrorClassInterface = Error & UnionToDiscriminatedUnion<Reason>;

    const isErrorClass = (value: unknown): value is ErrorClassInterface =>
      value instanceof ErrorClass;

    type CreateErrorClassReturnType = Record<ClassName, typeof ErrorClass> &
      Record<`is${ClassName}`, typeof isErrorClass>;

    return {
      [`${className}`]: ErrorClass<Reason>,
      [`is${className}`]: isErrorClass,
    } as CreateErrorClassReturnType;
  };
```

Published as `reasonable-error`. Usage:

```ts
const { LoginError, isLoginError } = createErrorClass<{
  UsernameDoesNotExist: undefined;
  WrongPassword: undefined;
  RateLimited: { retryAfterSeconds: number };
  UnexpectedError: undefined;
}>()("LoginError");

export type LoginErrorReason = InstanceType<typeof LoginError>["reason"];
export { LoginError, isLoginError };
```

The map is the point. **A reason mapped to `undefined` carries no payload**; constructing it
takes only `{ reason, cause? }`. **A reason mapped to a type requires a matching `context`**
at construction — `new LoginError("Too many attempts", { reason: "RateLimited", context: { retryAfterSeconds: 30 } })`
— and the guard narrows `context` alongside `reason`, so the view can read
`error.context.retryAfterSeconds` only in the branch where it exists.

The call is curried (`createErrorClass<Map>()("Name")`) because TypeScript cannot infer one
type argument while you supply another; the empty `()` is what lets `ClassName` stay
inferred from the string.

## 3. Type utilities

```ts
// Replace some properties of T with different types, keeping the rest.
type OverrideProperties<
  T,
  Overrides extends Partial<Record<keyof T, unknown>>,
> = Omit<T, keyof Overrides> & Overrides;

// The union of a type's property types — turns a const object into a literal union.
type ValueOf<T> = T[keyof T];
```
