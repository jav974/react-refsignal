/**
 * @jest-environment jsdom
 */
import React, { createElement, ReactNode } from 'react';
import { renderHook } from '@testing-library/react';
import { createNamedContext } from './createNamedContext';

function makeWrapper(Provider: React.FC<{ children: ReactNode }>) {
  return ({ children }: { children: ReactNode }) =>
    createElement(Provider, null, children);
}

describe('createNamedContext', () => {
  describe('factory', () => {
    it('calls the factory once per Provider mount', () => {
      const factory = jest.fn(() => ({ value: 42 }));
      const { TestProvider } = createNamedContext('Test', factory);

      const { rerender } = renderHook(() => {}, {
        wrapper: makeWrapper(TestProvider),
      });

      rerender();
      rerender();

      expect(factory).toHaveBeenCalledTimes(1);
    });

    it('calls the factory again when Provider remounts', () => {
      const factory = jest.fn(() => ({ value: 42 }));
      const { TestProvider } = createNamedContext('Test', factory);

      const { unmount } = renderHook(() => {}, {
        wrapper: makeWrapper(TestProvider),
      });
      unmount();

      renderHook(() => {}, { wrapper: makeWrapper(TestProvider) });

      expect(factory).toHaveBeenCalledTimes(2);
    });

    it('returns the store produced by the factory', () => {
      const store = { name: 'Alice', score: 100 };
      const { TestProvider, useTestContext } = createNamedContext(
        'Test',
        () => store,
      );

      const { result } = renderHook(() => useTestContext(), {
        wrapper: makeWrapper(TestProvider),
      });

      expect(result.current).toBe(store);
    });
  });

  describe('generated hook', () => {
    it('generates a hook named use${Name}Context', () => {
      const { useUserContext } = createNamedContext('User', () => ({}));
      expect(typeof useUserContext).toBe('function');
    });

    it('throws a descriptive error when used outside Provider', () => {
      const { useUserContext } = createNamedContext('User', () => ({}));

      expect(() => renderHook(() => useUserContext())).toThrow(
        'useUserContext must be used within a UserProvider',
      );
    });

    it('returns a stable store reference across re-renders', () => {
      const { StoreProvider, useStoreContext } = createNamedContext(
        'Store',
        () => ({ count: 0 }),
      );

      const { result, rerender } = renderHook(() => useStoreContext(), {
        wrapper: makeWrapper(StoreProvider),
      });

      const first = result.current;
      rerender();
      expect(result.current).toBe(first);
    });
  });

  describe('displayName', () => {
    it('sets displayName on the named Provider', () => {
      const { BillingProvider } = createNamedContext('Billing', () => ({}));
      expect(BillingProvider.displayName).toBe('BillingProvider');
    });
  });

  describe('isolation', () => {
    it('each Provider mount gets its own independent store', () => {
      let callCount = 0;
      const { CountProvider, useCountContext } = createNamedContext(
        'Count',
        () => ({ id: ++callCount }),
      );

      const { result: r1 } = renderHook(() => useCountContext(), {
        wrapper: makeWrapper(CountProvider),
      });
      const { result: r2 } = renderHook(() => useCountContext(), {
        wrapper: makeWrapper(CountProvider),
      });

      expect(r1.current.id).toBe(1);
      expect(r2.current.id).toBe(2);
      expect(r1.current).not.toBe(r2.current);
    });
  });
});
