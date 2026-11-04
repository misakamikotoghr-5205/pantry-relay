"""Deterministic label review, recipe allocation and provenance. No food-safety inference."""

from copy import deepcopy
from datetime import date, datetime, time, timedelta, timezone
from decimal import Decimal, InvalidOperation
import json
from pathlib import Path
import re
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

IDENTIFIER = re.compile(r'^[a-z][a-z0-9_-]{0,63}$')
QUANTITY = re.compile(r'^(?:0|[1-9]\d{0,8})(?:\.\d{1,3})?$')
UNITS = {'g', 'ml', 'each'}
SOURCE_KINDS = {'user_label', 'user_record', 'user_confirmation', 'user_recipe'}
NOTE = 'Dates only order and gate this plan. They do not establish that food is safe to eat. Review the actual label, storage and condition yourself; uncertain lots remain on hold.'


class InputError(ValueError):
    pass


class Conflict(ValueError):
    pass


class GateError(ValueError):
    def __init__(self, candidate):
        self.candidate = candidate
        super().__init__('Recipe is not executable with the currently eligible, user-confirmed stock.')


def canonical(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':'), allow_nan=False)


def parse_json(content):
    if len(content) > 1_000_000:
        raise InputError('JSON input exceeds 1 MB')
    def unique(pairs):
        result = {}
        for key, value in pairs:
            if key in result: raise InputError('Duplicate JSON field: ' + key)
            result[key] = value
        return result
    def nonfinite(_value):
        raise InputError('Non-finite JSON number')
    try:
        return json.loads(content, object_pairs_hook=unique, parse_constant=nonfinite)
    except (ValueError, UnicodeError, RecursionError) as exc:
        raise InputError('Invalid JSON input: ' + str(exc)) from exc


def load_json(path):
    return parse_json(Path(path).read_bytes())


def fields(value, required, optional=(), name='object'):
    if not isinstance(value, dict): raise InputError(name + ' must be an object')
    if set(value) - set(required) - set(optional): raise InputError(name + ' has unknown fields')
    if set(required) - set(value): raise InputError(name + ' is missing required fields')


def text(value, name, maximum=1000):
    if not isinstance(value, str) or not value.strip() or len(value) > maximum:
        raise InputError(name + ' must be nonblank text')
    return value.strip()


def identifier(value, name):
    if not isinstance(value, str) or not IDENTIFIER.fullmatch(value): raise InputError(name + ' must be a lowercase identifier')
    return value


def quantity(value, *, zero=True):
    if not isinstance(value, str) or not QUANTITY.fullmatch(value):
        raise InputError('Quantity must be a decimal string with at most three decimal places')
    result = Decimal(value)
    if not zero and result <= 0: raise InputError('Quantity must be greater than zero')
    return result


def decimal_text(value):
    return format(value, 'f').rstrip('0').rstrip('.') if '.' in format(value, 'f') else format(value, 'f')


def timestamp(value):
    if not isinstance(value, str): raise InputError('Timestamp must include an explicit time-zone offset')
    try:
        parsed = datetime.fromisoformat(value.replace('Z', '+00:00'))
    except ValueError as exc:
        raise InputError('Invalid ISO timestamp') from exc
    if parsed.tzinfo is None: raise InputError('Timestamp must include an explicit time-zone offset')
    return parsed.astimezone(timezone.utc)


def stamp(value):
    return value.astimezone(timezone.utc).isoformat(timespec='microseconds').replace('+00:00', 'Z')


def calendar_date(value):
    if not isinstance(value, str) or not re.fullmatch(r'\d{4}-\d{2}-\d{2}', value): raise InputError('Label date must be YYYY-MM-DD')
    try: return date.fromisoformat(value)
    except ValueError as exc: raise InputError('Invalid label date') from exc


def tags(value, name):
    if not isinstance(value, list) or len(value) > 50: raise InputError(name + ' must be a list of at most 50 tags')
    normalized = [text(tag, name, 80).casefold() for tag in value]
    if len(normalized) != len(set(normalized)): raise InputError(name + ' contains duplicate tags')
    return normalized


def validate_project(raw):
    fields(raw, {'schema_version', 'timezone', 'sources', 'lots', 'recipes', 'preferences'}, name='project')
    project = deepcopy(raw)
    if type(project['schema_version']) is not int or project['schema_version'] != 1: raise InputError('Only schema version 1 is supported')
    try: ZoneInfo(text(project['timezone'], 'timezone', 100))
    except (ZoneInfoNotFoundError, ValueError) as exc: raise InputError('Unknown IANA timezone') from exc
    if not isinstance(project['sources'], list) or not 1 <= len(project['sources']) <= 1000: raise InputError('Provide 1–1,000 sources')
    source_map = {}
    for source in project['sources']:
        fields(source, {'id', 'kind', 'text'}, name='source')
        identifier(source['id'], 'source id'); text(source['text'], 'source text', 4000)
        if not isinstance(source['kind'], str) or source['kind'] not in SOURCE_KINDS: raise InputError('Unsupported source kind')
        if source['id'] in source_map: raise InputError('Duplicate source id')
        source_map[source['id']] = source
    def reference(value, kind=None):
        if not isinstance(value, str) or value not in source_map: raise InputError('Unknown source reference')
        if kind and source_map[value]['kind'] != kind: raise InputError('Source kind does not match its use')
    units = {}
    if not isinstance(project['lots'], list) or not 1 <= len(project['lots']) <= 1000: raise InputError('Provide 1–1,000 stock lots')
    lot_ids = set()
    for lot in project['lots']:
        fields(lot, {'id', 'name', 'ingredient', 'quantity', 'unit', 'allergens', 'labels', 'confirmed_usable'},
               {'packed_on', 'opened_at', 'opened_source_id', 'after_open_hours', 'after_open_source_id', 'confirmation_source_id'}, 'lot')
        identifier(lot['id'], 'lot id'); identifier(lot['ingredient'], 'ingredient'); text(lot['name'], 'lot name', 160)
        if lot['id'] in lot_ids: raise InputError('Duplicate lot id')
        lot_ids.add(lot['id']); quantity(lot['quantity'])
        if not isinstance(lot['unit'], str) or lot['unit'] not in UNITS: raise InputError('Unit must be g, ml, or each')
        if lot['ingredient'] in units and units[lot['ingredient']] != lot['unit']: raise InputError('An ingredient cannot mix units; convert explicitly before import')
        units[lot['ingredient']] = lot['unit']
        if lot['unit'] == 'each' and quantity(lot['quantity']) % 1: raise InputError('each quantities must be whole numbers')
        lot['allergens'] = tags(lot['allergens'], 'lot allergens')
        if not isinstance(lot['labels'], list) or len(lot['labels']) > 20: raise InputError('labels must contain at most 20 sourced date claims')
        for label in lot['labels']:
            fields(label, {'kind', 'date', 'source_id'}, name='label')
            if label['kind'] not in ('use_by', 'best_before', 'user_limit'): raise InputError('Unknown label date kind')
            calendar_date(label['date']); reference(label['source_id'])
            if label['kind'] in ('use_by', 'best_before'): reference(label['source_id'], 'user_label')
            elif source_map[label['source_id']]['kind'] not in ('user_record', 'user_confirmation'): raise InputError('A user_limit needs a user record or confirmation source')
        if 'packed_on' in lot:
            fields(lot['packed_on'], {'date', 'source_id'}, name='packed_on')
            calendar_date(lot['packed_on']['date']); reference(lot['packed_on']['source_id'], 'user_label')
        if 'opened_at' in lot:
            timestamp(lot['opened_at']); reference(lot.get('opened_source_id'), 'user_record')
        elif 'opened_source_id' in lot: raise InputError('opened_source_id needs opened_at')
        if 'after_open_hours' in lot:
            if type(lot['after_open_hours']) is not int or not 1 <= lot['after_open_hours'] <= 8760: raise InputError('after_open_hours must be an integer in 1..8760')
            reference(lot.get('after_open_source_id'), 'user_label')
        elif 'after_open_source_id' in lot: raise InputError('after_open_source_id needs after_open_hours')
        if type(lot['confirmed_usable']) is not bool: raise InputError('confirmed_usable must be boolean')
        if lot['confirmed_usable']: reference(lot.get('confirmation_source_id'), 'user_confirmation')
        elif 'confirmation_source_id' in lot: reference(lot['confirmation_source_id'], 'user_confirmation')
    fields(project['preferences'], {'allergens', 'avoid_ingredients'}, name='preferences')
    project['preferences']['allergens'] = tags(project['preferences']['allergens'], 'excluded allergens')
    project['preferences']['avoid_ingredients'] = tags(project['preferences']['avoid_ingredients'], 'avoided ingredients')
    if not isinstance(project['recipes'], list) or not 1 <= len(project['recipes']) <= 200: raise InputError('Provide 1–200 user recipes')
    recipe_ids = set()
    for recipe in project['recipes']:
        fields(recipe, {'id', 'name', 'ingredients', 'allergens', 'source_id'}, name='recipe')
        identifier(recipe['id'], 'recipe id'); text(recipe['name'], 'recipe name', 160); reference(recipe['source_id'], 'user_recipe')
        if recipe['id'] in recipe_ids: raise InputError('Duplicate recipe id')
        recipe_ids.add(recipe['id']); recipe['allergens'] = tags(recipe['allergens'], 'recipe allergens')
        if not isinstance(recipe['ingredients'], list) or not 1 <= len(recipe['ingredients']) <= 50: raise InputError('A recipe needs 1–50 ingredients')
        seen = set()
        for requirement in recipe['ingredients']:
            fields(requirement, {'ingredient', 'quantity', 'unit'}, name='recipe ingredient')
            identifier(requirement['ingredient'], 'recipe ingredient'); quantity(requirement['quantity'], zero=False)
            if not isinstance(requirement['unit'], str) or requirement['unit'] not in UNITS: raise InputError('Unsupported recipe unit')
            if requirement['ingredient'] in seen: raise InputError('Duplicate recipe ingredient')
            seen.add(requirement['ingredient'])
            if requirement['ingredient'] in units and units[requirement['ingredient']] != requirement['unit']: raise InputError('Recipe and stock units do not match')
            if requirement['unit'] == 'each' and quantity(requirement['quantity']) % 1: raise InputError('each recipe quantities must be whole numbers')
    return project


def assess_lot(lot, project, at):
    now = timestamp(at) if isinstance(at, str) else at
    local = now.astimezone(ZoneInfo(project['timezone']))
    reasons, constraints = [], []
    def hold(code, detail, sources=()): reasons.append({'code': code, 'detail': detail, 'source_ids': list(sources)})
    grouped = {}
    for label in lot['labels']:
        grouped.setdefault(label['kind'], set()).add(label['date'])
        cutoff = datetime.combine(calendar_date(label['date']), time.max, tzinfo=ZoneInfo(project['timezone']))
        constraints.append({'kind': label['kind'], 'at': stamp(cutoff), 'source_ids': [label['source_id']]})
        if local.date() > calendar_date(label['date']): hold('label_date_passed', 'The entered label date has passed; review it rather than inferring usability.', [label['source_id']])
    for kind, dates in grouped.items():
        if len(dates) > 1: hold('conflicting_label_dates', 'Different entered dates for ' + kind + ' require resolution.', [label['source_id'] for label in lot['labels'] if label['kind'] == kind])
    if not lot['labels']: hold('missing_label_date', 'No sourced planning date is provided. Packaging date alone does not establish shelf life.')
    if 'packed_on' in lot:
        packed = calendar_date(lot['packed_on']['date'])
        if packed > local.date(): hold('future_packaging_date', 'The entered packaging date is in the future.', [lot['packed_on']['source_id']])
        if any(packed > calendar_date(label['date']) for label in lot['labels']): hold('date_order_conflict', 'Packaging date follows an entered label date.', [lot['packed_on']['source_id']])
    if 'opened_at' in lot:
        opened = timestamp(lot['opened_at'])
        if opened > now: hold('future_opening_record', 'The opening record is in the future.', [lot['opened_source_id']])
        if 'packed_on' in lot and opened.astimezone(ZoneInfo(project['timezone'])).date() < calendar_date(lot['packed_on']['date']): hold('date_order_conflict', 'Opening predates packaging.', [lot['opened_source_id'], lot['packed_on']['source_id']])
        if 'after_open_hours' not in lot: hold('missing_opening_instruction', 'Opened stock needs a user-entered label instruction; no default opening lifetime is guessed.', [lot['opened_source_id']])
        else:
            limit = opened + timedelta(hours=lot['after_open_hours'])
            constraints.append({'kind': 'after_open_label', 'at': stamp(limit), 'source_ids': [lot['opened_source_id'], lot['after_open_source_id']]})
            if now >= limit: hold('opening_instruction_elapsed', 'The entered after-opening label interval has elapsed; review is required.', [lot['after_open_source_id']])
    if not lot['confirmed_usable']: hold('user_confirmation_required', 'The user has not confirmed the label, storage and current condition.')
    excluded = set(lot['allergens']) & set(project['preferences']['allergens'])
    if excluded: hold('user_allergen_filter', 'Excluded by the user-provided allergen tags: ' + ', '.join(sorted(excluded)))
    if lot['ingredient'] in project['preferences']['avoid_ingredients']: hold('user_ingredient_filter', 'This ingredient is on the user-provided avoidance list.')
    return {'lot_id': lot['id'], 'status': 'empty' if quantity(lot['quantity']) == 0 else 'hold' if reasons else 'eligible_user_confirmed',
            'reasons': reasons, 'constraints': constraints,
            'priority_at': min((entry['at'] for entry in constraints), default=None),
            'confirmation_source_id': lot.get('confirmation_source_id'), 'safety_guarantee': False}


def plan_project(project, at, servings=1):
    project = validate_project(project)
    now = timestamp(at)
    if type(servings) is not int or not 1 <= servings <= 20: raise InputError('servings must be an integer in 1..20')
    reviews = {lot['id']: assess_lot(lot, project, now) for lot in project['lots']}
    candidates = []
    for recipe in project['recipes']:
        excluded = []
        allergens = set(recipe['allergens']) & set(project['preferences']['allergens'])
        if allergens: excluded.append({'code': 'user_allergen_filter', 'tags': sorted(allergens)})
        avoided = {item['ingredient'] for item in recipe['ingredients']} & set(project['preferences']['avoid_ingredients'])
        if avoided: excluded.append({'code': 'user_ingredient_filter', 'ingredients': sorted(avoided)})
        allocations, shortages, shopping = [], [], []
        for requirement in recipe['ingredients']:
            needed = quantity(requirement['quantity']) * servings
            matching = [lot for lot in project['lots'] if lot['ingredient'] == requirement['ingredient']]
            eligible = [lot for lot in matching if reviews[lot['id']]['status'] == 'eligible_user_confirmed']
            eligible.sort(key=lambda lot: (reviews[lot['id']]['priority_at'] or '9999', lot['id']))
            remaining = needed
            for lot in eligible:
                taken = min(remaining, quantity(lot['quantity']))
                if taken:
                    allocations.append({'lot_id': lot['id'], 'ingredient': lot['ingredient'], 'quantity': decimal_text(taken), 'unit': lot['unit'],
                                        'priority_at': reviews[lot['id']]['priority_at'], 'constraints': reviews[lot['id']]['constraints'],
                                        'confirmation_source_id': lot.get('confirmation_source_id')})
                    remaining -= taken
            if remaining:
                shortages.append({'ingredient': requirement['ingredient'], 'quantity': decimal_text(remaining), 'unit': requirement['unit'],
                                  'held_lot_ids': [lot['id'] for lot in matching if reviews[lot['id']]['status'] == 'hold']})
            physical = sum((quantity(lot['quantity']) for lot in matching), Decimal(0))
            if needed > physical: shopping.append({'ingredient': requirement['ingredient'], 'quantity': decimal_text(needed - physical), 'unit': requirement['unit']})
        candidates.append({'recipe_id': recipe['id'], 'name': recipe['name'], 'servings': servings, 'source_id': recipe['source_id'],
                           'can_consume': not excluded and not shortages, 'excluded': excluded,
                           'allocations': [] if excluded else allocations, 'eligible_stock_shortages': shortages,
                           'shopping_list': [] if excluded else shopping,
                           'priority_at': min((allocation['priority_at'] for allocation in allocations if allocation['priority_at']), default=None)})
    candidates.sort(key=lambda recipe: (not recipe['can_consume'], bool(recipe['excluded']), recipe['priority_at'] or '9999', recipe['recipe_id']))
    return {'schema_version': 1, 'as_of': stamp(now), 'timezone': project['timezone'], 'servings': servings,
            'next_recipe_id': next((recipe['recipe_id'] for recipe in candidates if recipe['can_consume']), None),
            'candidates': candidates, 'lot_review': list(reviews.values()), 'sources': deepcopy(project['sources']),
            'agents': [{'role': 'label-reviewer', 'engine': 'deterministic-rules', 'decision': 'Review each user-entered date and confirmation; hold uncertain lots.'},
                       {'role': 'recipe-allocator', 'engine': 'deterministic-rules', 'decision': 'Use eligible lots in earliest entered constraint order; filter exact user tags.'},
                       {'role': 'inventory-accountant', 'engine': 'deterministic-rules', 'decision': 'Preview only. Consumption must recheck stock in a transaction.'}],
            'reservations_created': False, 'safety_note': NOTE,
            'limitations': ['User tags are exact filters, not allergen detection or medical advice.', 'Recipe candidates are independent previews, not a combined reserved meal schedule.', 'Shopping quantities are physical stock deficits; held stock still needs review and is not assumed usable.']}
