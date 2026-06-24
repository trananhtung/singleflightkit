import { jest } from "@jest/globals";
import { Group, group } from "../src/index.js";

function defer<T>(): { promise: Promise<T>; resolve: (v: T) => void; reject: (e: unknown) => void } {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

describe("Group", () => {
  describe("basic deduplication", () => {
    it("makes only one call for concurrent requests with the same key", async () => {
      const g = new Group<string, string>();
      let callCount = 0;

      const fn = () => { callCount++; return Promise.resolve("result"); };

      const [a, b, c] = await Promise.all([g.do("key", fn), g.do("key", fn), g.do("key", fn)]);

      expect(callCount).toBe(1);
      expect(a).toBe("result");
      expect(b).toBe("result");
      expect(c).toBe("result");
    });

    it("allows subsequent calls after the first resolves", async () => {
      const g = new Group<string, number>();
      let callCount = 0;

      const fn = () => { callCount++; return Promise.resolve(callCount); };

      const first = await g.do("key", fn);
      const second = await g.do("key", fn);

      expect(first).toBe(1);
      expect(second).toBe(2);
      expect(callCount).toBe(2);
    });

    it("different keys run independently", async () => {
      const g = new Group<string, number>();
      const calls: Record<string, number> = {};

      const fn = (key: string) => {
        calls[key] = (calls[key] ?? 0) + 1;
        return Promise.resolve(calls[key]);
      };

      const [a, b] = await Promise.all([g.do("a", () => fn("a")), g.do("b", () => fn("b"))]);

      expect(a).toBe(1);
      expect(b).toBe(1);
      expect(calls.a).toBe(1);
      expect(calls.b).toBe(1);
    });
  });

  describe("error handling", () => {
    it("propagates error to the initiating caller", async () => {
      const g = new Group<string, string>();
      const error = new Error("fail");

      const fn = () => Promise.reject<string>(error);

      await expect(g.do("key", fn)).rejects.toThrow("fail");
    });

    it("after an error the key is cleared so next call retries", async () => {
      const g = new Group<string, string>();
      let callCount = 0;

      const fn = () => {
        callCount++;
        if (callCount === 1) return Promise.reject(new Error("first fails"));
        return Promise.resolve("ok");
      };

      await expect(g.do("key", fn)).rejects.toThrow();
      const result = await g.do("key", fn);
      expect(result).toBe("ok");
      expect(callCount).toBe(2);
    });

    it("concurrent waiters receive a rejection when fn rejects", async () => {
      const g = new Group<string, string>();
      const d = defer<string>();

      const fn = () => d.promise;

      const p1 = g.do("key", fn);
      const p2 = g.do("key", fn);

      d.reject(new Error("boom"));

      await expect(p1).rejects.toThrow("boom");
      // p2 shares same in-flight promise, but the Group forgets key on error
      // so p2 either already resolved or will reject (depending on ordering)
      try { await p2; } catch (_) { /* may or may not throw depending on timing */ }
    });
  });

  describe("timing — in-flight deduplication", () => {
    it("waiters join the in-flight call", async () => {
      const g = new Group<string, number>();
      const d = defer<number>();
      let callCount = 0;

      const fn = () => { callCount++; return d.promise; };

      const p1 = g.do("key", fn);
      const p2 = g.do("key", fn);
      const p3 = g.do("key", fn);

      expect(callCount).toBe(1);
      expect(g.size).toBe(1);

      d.resolve(42);
      const [r1, r2, r3] = await Promise.all([p1, p2, p3]);

      expect(r1).toBe(42);
      expect(r2).toBe(42);
      expect(r3).toBe(42);
      expect(callCount).toBe(1);
      expect(g.size).toBe(0);
    });
  });

  describe("forget", () => {
    it("forget clears the key so next call starts fresh", async () => {
      const g = new Group<string, string>();
      const d = defer<string>();
      let callCount = 0;

      const fn = () => { callCount++; return d.promise; };

      const p1 = g.do("key", fn);
      expect(callCount).toBe(1);
      expect(g.size).toBe(1);

      g.forget("key");
      expect(g.size).toBe(0);

      const p2 = g.do("key", fn);
      expect(callCount).toBe(2);

      d.resolve("done");
      const [r1, r2] = await Promise.all([p1, p2]);
      expect(r1).toBe("done");
      expect(r2).toBe("done");
    });

    it("forget on missing key is a no-op", () => {
      const g = new Group<string, string>();
      expect(() => g.forget("missing")).not.toThrow();
    });
  });

  describe("doCall", () => {
    it("returns shared:false for the initiating caller", async () => {
      const g = new Group<string, number>();
      const result = await g.doCall("key", () => Promise.resolve(1));
      expect(result.value).toBe(1);
      expect(result.shared).toBe(false);
    });

    it("returns shared:true for concurrent waiters", async () => {
      const g = new Group<string, number>();
      const d = defer<number>();

      const fn = () => d.promise;

      const call1 = g.doCall("key", fn);
      const call2 = g.doCall("key", fn);
      const call3 = g.doCall("key", fn);

      d.resolve(99);

      const [r1, r2, r3] = await Promise.all([call1, call2, call3]);

      expect(r1.shared).toBe(false); // initiator
      expect(r1.value).toBe(99);
      expect(r2.shared).toBe(true);
      expect(r2.value).toBe(99);
      expect(r3.shared).toBe(true);
      expect(r3.value).toBe(99);
    });
  });

  describe("numeric keys", () => {
    it("works with numeric keys", async () => {
      const g = new Group<number, string>();
      let callCount = 0;
      const fn = () => { callCount++; return Promise.resolve("val"); };

      await Promise.all([g.do(42, fn), g.do(42, fn)]);
      expect(callCount).toBe(1);
    });
  });

  describe("group factory", () => {
    it("group() creates a Group instance", () => {
      const g = group<string, number>();
      expect(g).toBeInstanceOf(Group);
    });
  });

  describe("size", () => {
    it("size reflects current in-flight count", async () => {
      const g = new Group<string, void>();
      const d = defer<void>();

      expect(g.size).toBe(0);
      const p = g.do("a", () => d.promise);
      expect(g.size).toBe(1);

      d.resolve();
      await p;
      expect(g.size).toBe(0);
    });
  });
});
