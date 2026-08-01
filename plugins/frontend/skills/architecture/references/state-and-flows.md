# State, flows, and forms

How multi-step processes, shared React state, and forms are modeled. Examples use a neutral
`CheckoutFlow`; substitute your own.

**Contents**

1. [Multi-step flows as discriminated unions](#multi-step-flows-as-discriminated-unions)
2. [The domain half](#the-domain-half)
3. [The view half](#the-view-half)
4. [Provider conventions](#provider-conventions)
5. [Forms](#forms)

## Multi-step flows as discriminated unions

A checkout, a signup wizard, a multi-stage modal — anything where the _shape_ of what you
know changes as the user advances.

The naive model is one flat object with everything optional:

```ts
type CheckoutFlow = {
  step: string;
  sessionId?: string;
  reservation?: Reservation;
  paymentInfo?: PaymentInfo;
};
```

Every component then re-asks questions the step already answered. `reservation!` appears,
or a null check that can never fire, and eventually someone reads `paymentInfo` at a step
where it does not exist yet.

Model the steps as a union instead, so each step declares exactly what it guarantees:

```ts
// src/domain/checkout-flow/CheckoutFlowStep.ts
type ValueOf<T> = T[keyof T];

export const CheckoutFlowSteps = {
  SelectSession: "SelectSession",
  SelectItems: "SelectItems",
  Payment: "Payment",
  Confirmation: "Confirmation",
} as const;

export type CheckoutFlowStep = ValueOf<typeof CheckoutFlowSteps>;

export const initialCheckoutFlowStep =
  "SelectSession" as const satisfies CheckoutFlowStep;
```

```ts
// src/domain/checkout-flow/CheckoutFlow.ts
export type CheckoutFlow =
  | CheckoutFlowAtSelectSession
  | CheckoutFlowAtSelectItems
  | CheckoutFlowAtPayment
  | CheckoutFlowAtConfirmation;

export type CheckoutFlowAtSelectSession = {
  step: typeof CheckoutFlowSteps.SelectSession;
  selectedProductId: Product["id"];
  reservation?: Reservation;
};

export type CheckoutFlowAtSelectItems = {
  step: typeof CheckoutFlowSteps.SelectItems;
  selectedProductId: Product["id"];
  selectedSessionInfo: SessionInfo;
  itemIntents: ItemIntent[];
  reservation: Reservation; // no longer optional — this step guarantees it
  reservationTimeout: NodeJS.Timeout;
};

// ...Payment and Confirmation add paymentInfo
```

The const-object-plus-`ValueOf` pattern (rather than a TS `enum`) gives both a value to
reference at runtime — `CheckoutFlowSteps.Payment` — and a string-literal union type, with
no enum runtime semantics. `satisfies` on the initial step makes a typo a compile error.

## The domain half

The flow type, its transitions, and its step guard all live in `domain/`. They are pure
functions of the current flow; nothing here knows a component exists.

**The type guard** is what lets the rest of the app narrow:

```ts
export const checkoutFlowIsAtStep = <Step extends CheckoutFlowStep>(
  checkoutFlow: CheckoutFlow,
  stepSpec: Step | Array<Step>,
): checkoutFlow is CheckoutFlow & { step: Step } => {
  if (Array.isArray(stepSpec)) {
    return stepSpec.includes(checkoutFlow.step as Step);
  }

  return checkoutFlow.step === stepSpec;
};
```

Accepting an array matters more than it looks: plenty of logic is valid across two adjacent
steps (`[SelectItems, Payment]`), and without it those call sites degrade into casts.

**Transitions return a new flow.** They never mutate, and they handle whatever cleanup the
outgoing step owns — clearing a reservation timer, releasing a hold:

```ts
export const goToPreviousStep = (checkoutFlow: CheckoutFlow): CheckoutFlow => {
  const { previousStep } = CheckoutFlowStepsMap[checkoutFlow.step];

  if (!previousStep) throw new Error("No previous step available");

  attemptToClearReservationTimeout(checkoutFlow);

  if (checkoutFlowIsAtStep(checkoutFlow, "Payment")) {
    return {
      step: previousStep,
      selectedProductId: checkoutFlow.selectedProductId,
      selectedSessionInfo: checkoutFlow.selectedSessionInfo,
      itemIntents: checkoutFlow.itemIntents,
      reservation: checkoutFlow.reservation,
    } as CheckoutFlowAtSelectItems;
  }

  // ...one branch per step that can go back
  throw new Error(`Unhandled previous step: ${previousStep}`);
};
```

Backward transitions are written field by field rather than spread, because going back
should _drop_ the fields the later step introduced. A spread would carry `paymentInfo`
backwards into a step whose type says it does not have one.

A `Record<Step, {nextStep, previousStep}>` map next to the transitions keeps the graph
readable in one place instead of scattered across conditionals.

## The view half

Three pieces: a provider holding the flow, a hook exposing guarded transitions, and a hook
that narrows to a step.

**`useCheckoutFlow`** wraps every transition with a step assertion, so an impossible
transition fails at the call site with a message naming both steps rather than corrupting
the flow:

```ts
export const useCheckoutFlow = () => {
  const value = useContext(CheckoutFlowContext);

  if (!value) {
    throw new Error(
      "useCheckoutFlow must be used within a CheckoutFlowProvider",
    );
  }

  const { checkoutFlow, setCheckoutFlow } = value;

  const goToPaymentInCheckoutFlow = () => {
    if (!checkoutFlowIsAtStep(checkoutFlow, [CheckoutFlowSteps.SelectItems])) {
      throw new Error(
        "Cannot go to payment when checkout flow is not at SelectItems step!",
      );
    }

    setCheckoutFlow({ ...checkoutFlow, step: CheckoutFlowSteps.Payment });
  };

  // ...one guarded function per transition

  return { checkoutFlow, goToPaymentInCheckoutFlow /* , ... */ };
};
```

The real work stays in domain functions; this hook's job is _guard, delegate, set_. When a
transition body grows past a few lines, it belongs in `domain/checkout-flow/`.

**`useCheckoutFlowAtStep`** is what step-specific components call. It asserts the step and
returns a narrowed flow, so those components get concrete types with no optional chaining:

```ts
export const useCheckoutFlowAtStep = <Step extends CheckoutFlowStep>(
  expectedStepSpec: Step | Array<Step>,
) => {
  const value = useCheckoutFlow();
  const { checkoutFlow } = value;

  if (!checkoutFlowIsAtStep(checkoutFlow, expectedStepSpec)) {
    throw new Error(
      `Expected checkout flow to be at step ${expectedStepSpec} but it was in ${checkoutFlow.step} instead!`,
    );
  }

  return { ...value, checkoutFlow };
};
```

A component that renders only during `SelectItems` calls
`useCheckoutFlowAtStep(CheckoutFlowSteps.SelectItems)` and can read `reservation` directly.
If it is ever mounted at the wrong step, that is a routing or conditional-rendering bug and
the throw surfaces it immediately, in the component that made the wrong assumption.

## Provider conventions

```tsx
export type CheckoutFlowProviderValue = {
  checkoutFlow: CheckoutFlow;
  setCheckoutFlow: (updated: CheckoutFlow) => void;
};

export const CheckoutFlowContext = createContext<
  CheckoutFlowProviderValue | undefined
>(undefined);

export const CheckoutFlowProvider = ({ children, initialCheckoutFlow }) => {
  const [checkoutFlow, setCheckoutFlow] = useState(initialCheckoutFlow);

  const value = useMemo(
    () => ({ checkoutFlow, setCheckoutFlow }),
    [checkoutFlow],
  );

  return (
    <CheckoutFlowContext.Provider value={value}>
      {children}
    </CheckoutFlowContext.Provider>
  );
};
```

- **Default to `undefined`, and let the consuming hook throw.** The alternative — a fake
  default value — turns "used outside its provider" into subtly wrong behavior instead of a
  clear error.
- **Memoize the context value.** Without it the object identity changes on every render of
  the provider and every consumer re-renders.
- **Providers own the lifecycle of what they hold.** If the state includes a timer, a
  subscription, or a server-side hold, the provider cleans it up on unmount. Otherwise the
  timer outlives the screen and fires a toast on an unrelated page:

  ```tsx
  const clearReservationTimeoutOnUnmount = useEffectEvent(() =>
    attemptToClearReservationTimeout(checkoutFlow),
  );

  useEffect(() => {
    return () => clearReservationTimeoutOnUnmount();
  }, [clearReservationTimeoutOnUnmount]);
  ```

  `useEffectEvent` lets the cleanup read current state without listing it as a dependency,
  which would re-run the effect on every change and defeat the point.

- **Initial-data providers hold no state at all** — they exist to hand server-fetched data
  to the tree. See `vertical-slice.md`.

## Forms

Two rules carry over to any form library.

**Schemas live in `view/` and delegate the rules to `domain/`.** A form schema encodes input
affordances and user-facing messages, not business truth:

```ts
export const LoginSchema = z
  .object({
    taxId: z
      .string()
      .refine((value) => isTaxIdValid(value), { message: "Invalid tax ID" }),
    password: PasswordSchema,
  })
  .strict();

export type Login = z.infer<typeof LoginSchema>;
```

`isTaxIdValid` is a domain function. The form owns the message; the domain owns the rule.
That way one rule guards a form field, an API payload, and a test, without three definitions
drifting apart.

**Forms whose fields depend on a mode use a discriminated union**, so selecting a payment
method changes which fields are required — instead of a pile of `.optional()` fields and a
hand-written cross-field check that has to re-derive the mode:

```ts
export const PaymentFormSchema = z.discriminatedUnion("paymentMethod", [
  CreditCardPaymentSchema, // paymentMethod: z.literal("CreditCard") + card fields
  BankTransferPaymentSchema,
  FreePaymentSchema,
]);

export type PaymentFormValues = z.infer<typeof PaymentFormSchema>;
```

Share field groups as plain objects (`const billingAddressFields = { zipcode: ..., city: ... }`)
and spread them into each variant.

Submit handlers do not implement rules. They call a domain action, `await` it, and route the
outcome — success callback, or the error mapping described in `errors.md`.
