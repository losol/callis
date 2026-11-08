import { describe, expect, it } from 'vitest';
import { stubModel, stubType } from '../../test/support/stub-model.ts';
import { JsonNumber, parseJson } from '../model/lossless-json.ts';
import { ModelNode } from '../model/model-node.ts';
import { Decimal } from '../values/decimal/decimal.ts';
import type { Collection, Item } from './collection.ts';
import {
  hasResourceType,
  type NavigationContext,
  navigateChildren,
  navigateMember as navigateMemberWith,
  navigateRoot as navigateRootWith,
  resourceTypeOf,
  toInputCollection,
} from './navigation.ts';

const modelLess: NavigationContext = { model: undefined, lenientChoiceSuffix: false };

function navigateMember(input: Collection, name: string): Collection {
  return navigateMemberWith(input, name, modelLess);
}

function navigateRoot(focus: Collection, name: string): Collection {
  return navigateRootWith(focus, name, modelLess);
}

/** An array of `length` holes whose prototype, below `Array.prototype`, has `inherited` indices. */
function inheritingArray(length: number, inherited: Record<number, unknown>): unknown[] {
  const array: unknown[] = new Array(length);
  Object.setPrototypeOf(array, Object.assign(Object.create(Array.prototype), inherited));
  return array;
}

function values(collection: Collection): unknown[] {
  return collection.map((item) => (item instanceof ModelNode ? item.value : item));
}

// Model-less navigation of plain JSON: https://hl7.org/fhirpath/N1/#navigation-model
describe('toInputCollection', () => {
  it.each([undefined, null, []])('gives empty for %j', (value) => {
    expect(toInputCollection(value, 'x')).toEqual([]);
  });

  it('wraps JSON objects and primitives in input nodes', () => {
    const [object, text, number, flag] = toInputCollection([{ a: 1 }, 'a', 1, true], 'v');
    for (const node of [object, text, number, flag]) {
      expect(node).toBeInstanceOf(ModelNode);
    }
    expect(values(toInputCollection([{ a: 1 }, 'a', 1, true], 'v'))).toEqual([
      { a: 1 },
      'a',
      1,
      true,
    ]);
  });

  it('names a node by its resourceType, or by the given name', () => {
    const [patient, other] = toInputCollection([{ resourceType: 'Patient' }, {}], 'input');
    expect((patient as ModelNode).name).toBe('Patient');
    expect((other as ModelNode).name).toBe('input');
  });

  it('flattens nested arrays and skips null elements', () => {
    expect(values(toInputCollection([1, null, [2, [3]]], 'v'))).toEqual([1, 2, 3]);
  });

  it('does not read array elements inherited from a prototype', () => {
    const array = inheritingArray(2, { 0: { inherited: true } });
    array[1] = 'own';
    expect(values(toInputCollection(array, 'v'))).toEqual(['own']);
  });

  it('keeps nodes and value classes as they are', () => {
    const node = new ModelNode({ value: 'x', name: 'x' });
    expect(toInputCollection([node, Decimal.ONE, 1n], 'v')).toEqual([node, Decimal.ONE, 1n]);
  });

  it.each([() => 1, Symbol('s')])('raises eval/invalid-argument for %s', (value) => {
    expect(() => toInputCollection(value, 'v')).toThrow(
      expect.objectContaining({ code: 'eval/invalid-argument' }),
    );
  });
});

describe('navigateMember', () => {
  const root = toInputCollection(
    { a: [{ b: 1 }, null, { b: [2, null, 3] }], c: 'x', d: null, e: [] },
    'root',
  );

  it('follows own properties and flattens arrays in order', () => {
    expect(values(navigateMember(navigateMember(root, 'a'), 'b'))).toEqual([1, 2, 3]);
  });

  it('records the name, parent and array index of each node', () => {
    const [first, second] = navigateMember(root, 'a');
    expect(first).toMatchObject({ name: 'a', index: 0, parent: root[0] });
    // The null element is skipped, but the index still counts it.
    expect(second).toMatchObject({ name: 'a', index: 2 });
    const [single] = navigateMember(root, 'c');
    expect(single).toMatchObject({ name: 'c', index: undefined });
  });

  it('gives empty for a missing, null or empty property', () => {
    for (const name of ['missing', 'd', 'e']) {
      expect(navigateMember(root, name)).toEqual([]);
    }
  });

  it.each(['__proto__', 'constructor', 'toString', 'hasOwnProperty', 'valueOf', 'prototype'])(
    'never reaches the prototype member %s',
    (name) => {
      expect(navigateMember(root, name)).toEqual([]);
    },
  );

  it('does not read array elements inherited from a prototype, and keeps the own indices', () => {
    const array = inheritingArray(3, { 0: 'inherited', 2: 'inherited' });
    array[1] = 'own';
    const [node, ...rest] = navigateMember(toInputCollection({ a: array }, 'root'), 'a');
    expect(rest).toEqual([]);
    expect(node).toMatchObject({ value: 'own', index: 1 });
  });

  it('skips holes in arrays', () => {
    // biome-ignore lint/suspicious/noSparseArray: the test needs a hole.
    const values = navigateMember(toInputCollection({ a: [1, , 3] }, 'root'), 'a');
    expect(values.map((item) => (item as ModelNode).index)).toEqual([0, 2]);
  });

  it('does not read inherited properties', () => {
    const input = toInputCollection(Object.create({ inherited: 1 }), 'root');
    expect(navigateMember(input, 'inherited')).toEqual([]);
  });

  it('gives no children for primitives and computed values', () => {
    expect(navigateMember(navigateMember(root, 'c'), 'length')).toEqual([]);
    expect(navigateMember(['text', 1, true, Decimal.ONE], 'length')).toEqual([]);
  });
});

describe('navigateRoot', () => {
  const patient = toInputCollection({ resourceType: 'Patient', id: 'p', Patient: 'child' }, 'r');

  // https://hl7.org/fhirpath/N1/#models; T0018 navigation rules for the model-less case.
  it('gives the item itself when the name is its resourceType', () => {
    expect(navigateRoot(patient, 'Patient')).toEqual(patient);
  });

  it('is an ordinary path step otherwise', () => {
    expect(values(navigateRoot(patient, 'id'))).toEqual(['p']);
    expect(navigateRoot(patient, 'Observation')).toEqual([]);
  });

  it('decides for each item', () => {
    const mixed = toInputCollection([{ resourceType: 'Patient' }, { Patient: 1 }], 'r');
    expect(values(navigateRoot(mixed, 'Patient'))).toEqual([{ resourceType: 'Patient' }, 1]);
  });
});

describe('resourceTypeOf and hasResourceType', () => {
  it('reads an own string resourceType', () => {
    expect(resourceTypeOf({ resourceType: 'Patient' })).toBe('Patient');
  });

  it.each<[string, unknown]>([
    ['an inherited one', Object.create({ resourceType: 'Patient' })],
    ['a number', { resourceType: 1 }],
    ['null', { resourceType: null }],
    ['an array', [{ resourceType: 'Patient' }]],
    ['a string value', 'Patient'],
    ['null input', null],
  ])('ignores %s', (_label, value) => {
    expect(resourceTypeOf(value)).toBeUndefined();
  });

  it('matches only input nodes, case-sensitively', () => {
    const [node] = toInputCollection({ resourceType: 'Patient' }, 'r');
    expect(node !== undefined && hasResourceType(node, 'Patient')).toBe(true);
    expect(node !== undefined && hasResourceType(node, 'patient')).toBe(false);
    expect(hasResourceType('Patient', 'Patient')).toBe(false);
  });
});

describe('lossless JSON numbers', () => {
  it('are primitive nodes, not objects with children', () => {
    const input = toInputCollection(parseJson('{"a": {"b": 1.50}, "c": 2}'), 'root');
    const [b] = navigateMember(navigateMember(input, 'a'), 'b');
    expect(b).toBeInstanceOf(ModelNode);
    expect((b as ModelNode).value).toBeInstanceOf(JsonNumber);
    expect(navigateMember(navigateMember(input, 'a'), 'b').length).toBe(1);
    expect(navigateMember(navigateMember(navigateMember(input, 'a'), 'b'), 'text')).toEqual([]);
    expect(resourceTypeOf(new JsonNumber('1'))).toBeUndefined();
  });

  it('are accepted as top-level input', () => {
    const [node] = toInputCollection(new JsonNumber('1.50'), 'n');
    expect(node).toMatchObject({ name: 'n', value: new JsonNumber('1.50') });
  });
});

// https://github.com/losol/callis/blob/main/docs/tasks/T0018-model-aware-evaluation.md#navigation-rules
describe('with a model', () => {
  const ctx: NavigationContext = { model: stubModel, lenientChoiceSuffix: false };
  const lenient: NavigationContext = { model: stubModel, lenientChoiceSuffix: true };
  const birthTime = {
    url: 'http://hl7.org/fhir/StructureDefinition/patient-birthTime',
    valueDateTime: '1974-12-25T14:35:45-05:00',
  };
  const syllables = { url: 'https://example.org/syllable-count', valueString: 'five' };
  const patientJson = {
    resourceType: 'Patient',
    id: 'p1',
    active: true,
    name: [
      {
        use: 'official',
        given: ['Peter', null, 'James'],
        _given: [null, { extension: [syllables] }, null],
        family: 'Chalmers',
      },
      { given: ['Jim'] },
    ],
    telecom: [{ system: 'phone', use: 'home' }],
    gender: 'male',
    birthDate: '1974-12-25',
    _birthDate: { extension: [birthTime] },
    deceasedBoolean: false,
    multipleBirthInteger: 2,
    contained: [{ resourceType: 'Observation', status: 'final' }, { resourceType: 'Foo' }],
    unknownKey: 'x',
  };
  const observationJson = {
    resourceType: 'Observation',
    status: 'final',
    effectivePeriod: { start: '2016-03-28' },
    valueQuantity: {
      value: 185,
      unit: 'lbs',
      system: 'http://unitsofmeasure.org',
      code: '[lb_av]',
    },
  };
  const patient = toInputCollection(patientJson, 'input', stubModel);
  const observation = toInputCollection(observationJson, 'input', stubModel);
  const member = (input: Collection, name: string): Collection =>
    navigateMemberWith(input, name, ctx);
  const path = (input: Collection, ...names: string[]): Collection => names.reduce(member, input);
  const nodes = (collection: Collection): ModelNode[] =>
    collection.map((item) => {
      expect(item).toBeInstanceOf(ModelNode);
      return item as ModelNode;
    });

  describe('toInputCollection', () => {
    it('types a root object by its resourceType', () => {
      const [root] = nodes(patient);
      expect(root).toMatchObject({ name: 'Patient', type: stubType('Patient') });
      expect(root?.systemType).toBeUndefined();
    });

    it('leaves an object the model does not recognize, and primitives, untyped', () => {
      const [unknown, plain, text] = nodes(
        toInputCollection([{ resourceType: 'Foo' }, { name: [] }, 'text'], 'v', stubModel),
      );
      expect(unknown?.type).toBeUndefined();
      expect(unknown?.name).toBe('Foo');
      expect(plain?.type).toBeUndefined();
      expect(text?.type).toBeUndefined();
    });
  });

  describe('navigateMember', () => {
    it('types each node by its element, with the System type it converts to', () => {
      const [active] = nodes(member(patient, 'active'));
      expect(active).toMatchObject({
        value: true,
        type: stubType('boolean'),
        systemType: 'Boolean',
      });
      const [gender] = nodes(member(patient, 'gender'));
      expect(gender).toMatchObject({ value: 'male', type: stubType('code'), systemType: 'String' });
      const names = nodes(member(patient, 'name'));
      expect(names.map((node) => [node.type, node.index, node.parent])).toEqual([
        [stubType('HumanName'), 0, patient[0]],
        [stubType('HumanName'), 1, patient[0]],
      ]);
      expect(names[0]?.systemType).toBeUndefined();
    });

    it('does not navigate JSON keys that are not elements, including resourceType', () => {
      expect(member(patient, 'unknownKey')).toEqual([]);
      expect(member(patient, 'resourceType')).toEqual([]);
      expect(member(patient, '_birthDate')).toEqual([]);
    });

    // https://hl7.org/fhir/R4/json.html#primitive
    it('merges a primitive with its _name object', () => {
      const [birthDate] = nodes(member(patient, 'birthDate'));
      expect(birthDate).toMatchObject({
        value: '1974-12-25',
        type: stubType('date'),
        systemType: 'Date',
        primitiveElement: patientJson._birthDate,
        index: undefined,
      });
      const [family] = nodes(path(patient, 'name', 'family'));
      expect(family?.primitiveElement).toBeUndefined();
    });

    it('aligns repeating primitives with their _name array by index', () => {
      const given = nodes(path(patient, 'name', 'given'));
      expect(given.map((node) => [node.value, node.index, node.primitiveElement])).toEqual([
        ['Peter', 0, undefined],
        [undefined, 1, { extension: [syllables] }],
        ['James', 2, undefined],
        ['Jim', 0, undefined],
      ]);
      expect(given.every((node) => node.type === stubType('string'))).toBe(true);
    });

    it('gives the id and extension of a primitive from its _name object', () => {
      const birthDate = member(patient, 'birthDate');
      const [extension] = nodes(member(birthDate, 'extension'));
      expect(extension).toMatchObject({ value: birthTime, type: stubType('Extension'), index: 0 });
      expect(extension?.parent).toBe(birthDate[0]);
      expect(nodes(path(patient, 'birthDate', 'extension', 'url'))[0]?.value).toBe(birthTime.url);
      const [valueDateTime] = nodes(path(patient, 'birthDate', 'extension', 'value'));
      expect(valueDateTime).toMatchObject({
        value: birthTime.valueDateTime,
        type: stubType('dateTime'),
      });
      expect(path(patient, 'birthDate', 'id')).toEqual([]);
      expect(path(patient, 'name', 'family', 'extension')).toEqual([]);
      const syllableCount = nodes(path(patient, 'name', 'given', 'extension', 'value'));
      expect(syllableCount.map((node) => node.value)).toEqual(['five']);
    });

    it('does not give a primitive its implicit value as a child', () => {
      expect(path(patient, 'active', 'value')).toEqual([]);
    });

    // https://hl7.org/fhir/R5/fhirpath.html#polymorphism
    it('finds a choice element under its typed JSON key and types the node by it', () => {
      const [deceased] = nodes(member(patient, 'deceased'));
      expect(deceased).toMatchObject({ value: false, name: 'deceased', type: stubType('boolean') });
      const [births] = nodes(member(patient, 'multipleBirth'));
      expect(births).toMatchObject({ value: 2, type: stubType('integer'), systemType: 'Integer' });
      const [value] = nodes(member(observation, 'value'));
      expect(value).toMatchObject({
        value: observationJson.valueQuantity,
        name: 'value',
        type: stubType('Quantity'),
        systemType: 'Quantity',
      });
      expect(nodes(path(observation, 'value', 'unit'))[0]?.value).toBe('lbs');
      const [effective] = nodes(member(observation, 'effective'));
      expect(effective).toMatchObject({ type: stubType('Period'), name: 'effective' });
      expect(nodes(path(observation, 'effective', 'start'))[0]?.type).toBe(stubType('dateTime'));
    });

    it('gives empty for a choice element written with its type suffix', () => {
      expect(member(observation, 'valueQuantity')).toEqual([]);
      expect(member(patient, 'deceasedBoolean')).toEqual([]);
    });

    // ADR-0012: lenient.choiceSuffix accepts the suffix form for compatibility.
    it('accepts the type suffix with lenientChoiceSuffix, for the one type it names', () => {
      const [value] = nodes(navigateMemberWith(observation, 'valueQuantity', lenient));
      expect(value).toMatchObject({ name: 'value', type: stubType('Quantity') });
      expect(navigateMemberWith(observation, 'valueString', lenient)).toEqual([]);
      expect(navigateMemberWith(observation, 'valueFoo', lenient)).toEqual([]);
      expect(navigateMemberWith(observation, 'valu', lenient)).toEqual([]);
      expect(navigateMemberWith(observation, 'value', lenient)).toHaveLength(1);
      expect(navigateMemberWith(observation, 'statusCode', lenient)).toEqual([]);
    });

    it('types contained resources by their resourceType, falling back to the element type', () => {
      const contained = nodes(member(patient, 'contained'));
      expect(contained.map((node) => node.type)).toEqual([
        stubType('Observation'),
        stubType('Resource'),
      ]);
      expect(nodes(path(patient, 'contained', 'status'))[0]?.type).toBe(stubType('code'));
    });

    it('types Bundle.entry.resource by its resourceType', () => {
      const bundle = toInputCollection(
        { resourceType: 'Bundle', entry: [{ resource: { resourceType: 'Patient', id: 'x' } }] },
        'input',
        stubModel,
      );
      const [resource] = nodes(path(bundle, 'entry', 'resource'));
      expect(resource?.type).toBe(stubType('Patient'));
      expect(nodes(path(bundle, 'entry'))[0]?.type).toBe(stubType('Bundle.entry'));
      expect(nodes(path(bundle, 'entry', 'resource', 'id'))[0]?.value).toBe('x');
    });

    it('navigates an untyped node by its JSON keys without giving it a type', () => {
      const unknown = toInputCollection(
        { resourceType: 'Foo', name: [{ given: ['x'] }], _name: 1 },
        'input',
        stubModel,
      );
      const given = nodes(path(unknown, 'name', 'given'));
      expect(given).toHaveLength(1);
      expect(given[0]?.type).toBeUndefined();
      expect(nodes(member(unknown, '_name'))[0]?.value).toBe(1);
      expect(member(unknown, 'resourceType')).toHaveLength(1);
    });

    it('flattens nested arrays of complex values and skips holes and nulls', () => {
      const names = new Array<unknown>(4);
      names[0] = [{ use: 'a' }];
      names[1] = null;
      names[3] = { use: 'b' };
      const input = toInputCollection({ resourceType: 'Patient', name: names }, 'i', stubModel);
      expect(nodes(path(input, 'name', 'use')).map((node) => node.value)).toEqual(['a', 'b']);
    });

    it('reads a primitive that is not an array next to a _name array', () => {
      const input = toInputCollection(
        { resourceType: 'Patient', name: [{ given: 'x', _given: [{ id: 'g' }, { id: 'h' }] }] },
        'i',
        stubModel,
      );
      const given = nodes(path(input, 'name', 'given'));
      expect(given.map((node) => [node.value, node.primitiveElement])).toEqual([
        ['x', { id: 'g' }],
        [undefined, { id: 'h' }],
      ]);
    });

    it('ignores a _name that is not an object, and arrays inside a primitive array', () => {
      const input = toInputCollection(
        {
          resourceType: 'Patient',
          birthDate: '1974',
          _birthDate: 'x',
          name: [{ given: [['a'], 'b'] }],
        },
        'i',
        stubModel,
      );
      expect(nodes(member(input, 'birthDate'))[0]?.primitiveElement).toBeUndefined();
      expect(nodes(path(input, 'name', 'given')).map((node) => node.value)).toEqual(['b']);
    });

    it('keeps the values of a primitive-typed element that holds an object', () => {
      const input = toInputCollection(
        { resourceType: 'Patient', active: { x: 1 } },
        'i',
        stubModel,
      );
      const [active] = nodes(member(input, 'active'));
      expect(active).toMatchObject({ value: { x: 1 }, type: stubType('boolean') });
      expect(member(member(input, 'active'), 'x')).toEqual([]);
    });

    it('reads only own properties of the data', () => {
      const data: object = Object.create({ active: true });
      Object.defineProperty(data, 'resourceType', { value: 'Patient', enumerable: true });
      const input = toInputCollection(data, 'i', stubModel);
      expect(nodes(input)[0]?.type).toBe(stubType('Patient'));
      expect(member(input, 'active')).toEqual([]);
    });
  });

  // https://hl7.org/fhirpath/N1/#models, https://hl7.org/fhir/R5/fhirpath.html#rules
  describe('navigateRoot', () => {
    const root = (focus: Collection, name: string): Collection =>
      navigateRootWith(focus, name, ctx);

    it('gives the item for its own type and for a base type', () => {
      for (const name of ['Patient', 'DomainResource', 'Resource']) {
        expect(root(patient, name)).toEqual(patient);
      }
      const names = member(patient, 'name');
      expect(root(names, 'HumanName')).toEqual(names);
      expect(root(names, 'Element')).toEqual(names);
    });

    it('gives empty for a different type, with no resourceType fallback', () => {
      expect(root(patient, 'Observation')).toEqual([]);
      expect(root(patient, 'HumanName')).toEqual([]);
      const unknown = toInputCollection(
        { resourceType: 'Foo', Foo: 1, Patient: 2 },
        'i',
        stubModel,
      );
      expect(root(unknown, 'Patient')).toEqual([]);
      expect(root(['Patient', 1], 'Patient')).toEqual([]);
    });

    it('treats a primitive type name, and any other name, as a path', () => {
      expect(nodes(root(patient, 'id'))[0]?.value).toBe('p1');
      expect(nodes(root(member(patient, 'telecom'), 'use'))[0]?.value).toBe('home');
      expect(root(patient, 'date')).toEqual([]);
      expect(nodes(root(patient, 'active'))[0]?.value).toBe(true);
      // Not a type: an ordinary path, which an unknown resourceType does not satisfy either.
      const unknown = toInputCollection({ resourceType: 'Foo', Foo: 1 }, 'i', stubModel);
      expect(root(unknown, 'Foo')).toEqual([
        new ModelNode({ value: 1, name: 'Foo', parent: unknown[0] as ModelNode }),
      ]);
    });

    it('decides for each item', () => {
      const mixed: Collection = [...patient, ...observation, 'x'];
      expect(root(mixed, 'Patient')).toEqual(patient);
      expect(root(mixed, 'Observation')).toEqual(observation);
      expect(root(mixed, 'DomainResource')).toEqual([...patient, ...observation]);
    });
  });

  // https://hl7.org/fhirpath/N1/#children-collection
  describe('navigateChildren', () => {
    it('lists the elements of a typed node in definition order', () => {
      const children = nodes(navigateChildren(patient, ctx));
      expect(children.map((node) => node.name)).toEqual([
        'id',
        'contained',
        'contained',
        'active',
        'name',
        'name',
        'telecom',
        'gender',
        'birthDate',
        'deceased',
        'multipleBirth',
      ]);
      expect(children.find((node) => node.name === 'birthDate')?.primitiveElement).toBe(
        patientJson._birthDate,
      );
      expect(children.find((node) => node.name === 'deceased')?.type).toBe(stubType('boolean'));
    });

    it('lists the id and extension of a typed primitive', () => {
      const children = nodes(navigateChildren(member(patient, 'birthDate'), ctx));
      expect(children.map((node) => [node.name, node.type])).toEqual([
        ['extension', stubType('Extension')],
      ]);
      expect(navigateChildren(member(patient, 'gender'), ctx)).toEqual([]);
    });

    it('lists the JSON properties of an untyped node, except resourceType and _name keys', () => {
      const unknown = toInputCollection(
        { resourceType: 'Foo', a: [1, 2], _a: [null, {}], b: { c: 1 }, _d: {} },
        'i',
        stubModel,
      );
      const children = nodes(navigateChildren(unknown, ctx));
      expect(children.map((node) => [node.name, node.value])).toEqual([
        ['a', 1],
        ['a', 2],
        ['b', { c: 1 }],
      ]);
      expect(children[0]?.type).toBeUndefined();
    });

    it('works the same way without a model', () => {
      const input = toInputCollection({ resourceType: 'Patient', a: 1, _a: {} }, 'i');
      expect(nodes(navigateChildren(input, modelLess)).map((node) => node.name)).toEqual(['a']);
      expect(navigateChildren(['x', 1, Decimal.ONE], modelLess)).toEqual([]);
      expect(navigateChildren(member(input, 'a'), modelLess)).toEqual([]);
    });

    it('gives empty for a collection without nodes', () => {
      const items: Item[] = [1, 'a'];
      expect(navigateChildren(items, ctx)).toEqual([]);
    });
  });
});
