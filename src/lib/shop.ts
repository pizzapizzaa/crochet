/*
 * The handful of facts about the shop itself.
 *
 * Contact, the policy pages and the packing slip all need to state the same
 * address, the same number and the same promises. Kept here so that when the
 * workshop moves or the dispatch window changes, it changes in one file rather
 * than in whichever pages somebody remembers to look at.
 */

export const SHOP_NAME = 'ZippyZack';
export const SHOP_DOMAIN = 'zippyzack.com';

export const SHOP_ADDRESS = ['96/114 Dang Thuy Tram', 'Binh Loi Trung', 'Vietnam'];
export const SHOP_PHONE = '+84 902 672 192';
export const SHOP_EMAIL = 'zippyzack@proton.me';

/** Dial-able form of the number — spaces are for reading, not for phones. */
export const SHOP_PHONE_HREF = `tel:${SHOP_PHONE.replace(/\s/g, '')}`;

/*
 * The delivery promises the storefront makes. These are quoted on the shipping
 * page and on the receipt, so they are numbers rather than prose: a change here
 * changes what the customer is told everywhere at once.
 */
export const DISPATCH_DAYS = { min: 1, max: 3 };
export const DELIVERY_DAYS = {
  vietnam: { min: 2, max: 5 },
  international: { min: 10, max: 21 },
};

/** How long a customer has to tell us something is wrong. */
export const RETURNS_WINDOW_DAYS = 14;

/**
 * How long an unpaid checkout is held before it is swept away.
 *
 * The same number is given to payOS as the payment link's own expiry, so the
 * link dying and the order being cancelled happen at roughly the same moment
 * rather than leaving a window where one is true and the other is not.
 */
export const PAYMENT_WINDOW_MINUTES = Number(
  import.meta.env.PAYMENT_WINDOW_MINUTES ?? 60 * 24,
);
