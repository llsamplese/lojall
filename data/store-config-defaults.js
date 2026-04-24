module.exports = {
  ui: {
    showCouponBoxHome: true,
    showCouponBoxProductDirect: true,
    showCouponBoxPackageDirect: true,
    showAvailableCouponsPanelHome: true,
    showAvailableCouponsPanelProductDirect: true,
    showAvailableCouponsPanelPackageDirect: true,
    showPackagesPanel: true,
    showPackagesPanelHome: true,
    showPackagesPanelProductDirect: true,
    showPackagesPanelPackageDirect: true,
    showCopyNamesButton: true,
    showCopyOrderButton: true,
    showSelectAllButton: true,
    showClearAllButton: true,
    showFiltersButton: true,
    showCustomerMenuButton: true
  },
  couponRuntime: {
    hideHomeCouponsAfterExpiry: false,
    lastAutoExpiredAt: ""
  },
  globalPricing: {
    active: false,
    type: "percent",
    value: 0
  },
  deletedCoupons: [],
  coupons: {},
  productOverrides: {},
  packages: {}
};
