// ============================================================================
// ZONE 1: CORE ENUMS & LITERALS
// ============================================================================

export type AnimalCategory = 'OWL' | 'RAPTOR' | 'MAMMAL' | 'EXOTIC' | 'INVERT' | 'AQUATIC' | string;
export type RecordType = 'INDIVIDUAL' | 'GROUP' | 'COLLECTION';
export type Gender = 'MALE' | 'FEMALE' | 'UNKNOWN' | 'MIXED_GROUP';
export type IUCNStatus = 'NE' | 'DD' | 'LC' | 'NT' | 'VU' | 'EN' | 'CR' | 'EW' | 'EX';

// The unified feeding outcome
export type DietOutcome = 'EATEN' | 'REFUSED' | 'FASTING' | 'NOT_CAST' | 'REGURGITATED';

// The scheduling triage states
export type ScheduleStatus = 'PENDING' | 'COMPLETED' | 'REFUSED' | 'FASTING' | 'NOT_CAST';

export type MistLevel = 'LIGHT' | 'MEDIUM' | 'HEAVY';

// ============================================================================
// ZONE 2: DATABASE ENTITIES (V3 SCHEMA POSTGRESQL DEFINITIONS)
// ============================================================================

export interface User {
  id: string; // uuid
  email: string | null;
  name: string | null;
  role: string | null; // Mapped to RBAC
  initials: string | null;
  is_active: boolean;
  avatar_url: string | null;
  phone: string | null;
  pin: string | null;
  requires_password_change: boolean;
  created_at?: string;
  updated_at?: string;
}

export interface Animal {
  id: string; // uuid
  parent_group_id: string | null; // For enclosures or mobs
  record_type: RecordType;
  name: string;
  species: string | null;
  latin_name: string | null;
  category: AnimalCategory | null;
  location: string | null;
  profile_image_url: string | null;
  distribution_map_url: string | null;
  hazard_rating: string | null;
  is_venomous: boolean;
  weight_unit: string;
  flying_weight: number | null;
  winter_weight: number | null;
  average_target_weight: number | null;
  date_of_birth: string | null;
  is_dob_unknown: boolean;
  gender: Gender | null;
  microchip_id: string | null;
  ring_number: string | null;
  has_no_id: boolean;
  red_list_status: IUCNStatus;
  description: string | null;
  special_requirements: string | null;
  critical_husbandry_notes: string | null;
  ambient_temp_only: boolean;
  target_day_temp_c: number | null;
  target_night_temp_c: number | null;
  target_humidity_min_percent: number | null;
  status?: string | null;
  archived: boolean;
  is_deleted?: boolean;
  created_at?: string;
  updated_at?: string;
}

export interface FeedingSchedule {
  id: string; // uuid
  animal_id: string; // uuid
  scheduled_date: string; // YYYY-MM-DD
  food_type: string | null;
  quantity: number | null;
  quantity_unit: string | null;
  status: ScheduleStatus;
  supplements: string | null;
  notes: string | null;
  presentation_method: string | null;
  is_deleted: boolean;
  logged_feed_id: string | null;
  created_by: string | null; // uuid
  created_at?: string;
  updated_at?: string;
}

// Normalized V3 Husbandry Tables
export interface FeedLog {
  id?: string;
  animal_id: string;
  recorded_by: string; // uuid
  recorded_at: string;
  food_item: string;
  feed_method?: string | null;
  quantity: number;
  unit: string;
  calci_dust_added?: boolean | null;
  schedule_id?: string | null;
  outcome?: DietOutcome | string | null;
  notes?: string | null;
  is_deleted?: boolean | null;
  created_by?: string | null;
  created_at?: string | null;
  modified_by?: string | null;
  modified_at?: string | null;
}

export interface WeightLog {
  id?: string;
  animal_id: string;
  recorded_by: string; // uuid
  recorded_at: string;
  weight_grams?: number | null;
  am_pm?: string | null;
  has_cast?: boolean | null;
  is_deleted?: boolean | null;
  notes?: string | null;
  created_by?: string | null;
  created_at?: string | null;
  modified_by?: string | null;
}

export interface TemperatureLog {
  id?: string;
  animal_id: string;
  recorded_by: string; // uuid
  recorded_at: string;
  temp_basking?: number | null;
  temp_cool?: number | null;
  temp_average?: number | null;
  temp_ambient?: number | null;
  notes?: string | null;
  is_deleted?: boolean | null;
  created_by?: string | null;
  created_at?: string | null;
  modified_by?: string | null;
  modified_at?: string | null;
}

// Add this to your Husbandry Tables (Zone 2)
export interface MistLog {
  id?: string;
  animal_id: string;
  recorded_by: string; // uuid of the Keeper
  recorded_at: string; // timestamp
  mist_level: MistLevel;
  am_pm: 'AM' | 'PM';
  notes?: string | null;
  is_deleted?: boolean | null;
  created_by?: string | null;
  created_at?: string | null;
  modified_by?: string | null;
  modified_at?: string | null;
}
export interface ClinicalRecord {
  id?: string;
  animal_id: string;
  record_type: string;
  record_date: string;
  title: string;
  soap_subjective: string;
  soap_objective: string;
  soap_assessment: string;
  soap_plan: string;
  conductor_role: string;
  conducted_by: string;
  external_vet_name?: string | null;
  external_vet_clinic?: string | null;
  weight_log_id?: string | null;
  is_deleted?: boolean | null;
  created_by: string;
  modified_by: string;
  created_at?: string | null;
  updated_at?: string | null;
}

export interface ClinicalSchedule {
  id?: string;
  animal_id: string;
  schedule_type: string;
  medication_name: string;
  dosage: string;
  frequency: string;
  start_date: string;
  end_date?: string | null;
  status: string;
  notes?: string | null;
  instructions?: string | null;
  is_deleted?: boolean | null;
  created_by: string;
  modified_by: string;
  created_at?: string | null;
  updated_at?: string | null;
}

// ------------------------------------------------------------------
// MISSING PHASE 2 AUDIT TYPES (LAUNCH BLOCKERS RESOLVED)
// ------------------------------------------------------------------

export interface DailyRound {
  id?: string;
  animal_id: string;
  record_date: string; // V3 UI Mapping alias for 'date'
  shift: string;
  section?: string | null;
  conducted_by?: string | null; // V3 UI Mapping alias for 'completed_by'
  completed_at?: string | null;
  status?: string;
  animal_issue_note?: string | null;
  requires_followup?: boolean | null;
  followup_notes?: string | null;
  is_alive?: boolean | null;
  water_checked?: boolean | null;
  locks_secured?: boolean | null;
  is_deleted?: boolean | null;
  created_by?: string | null;
  modified_by?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
}

export interface SafetyDrill {
  id?: string;
  drill_date: string;
  drill_type?: string | null;
  scenario_description?: string | null;
  areas_involved?: string | null;
  duration_seconds?: number | null;
  roll_call_completed?: boolean | null;
  issues_observed?: string | null;
  corrective_actions?: string | null;
  status?: string | null;
  is_simulation?: boolean | null;
  is_deleted?: boolean | null;
  created_at?: string | null;
  updated_at?: string | null;
}

export interface ExternalContact {
  id?: string;
  name: string;
  role: string;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  is_deleted?: boolean | null;
  created_at?: string | null;
  updated_at?: string | null;
}

export interface OrganizationProfile {
  id?: string;
  org_name: string;
  logo_url?: string | null;
  contact_email?: string | null;
  contact_phone?: string | null;
  address?: string | null;
  website?: string | null;
  license_number?: string | null;
  is_deleted?: boolean | null;
  created_at?: string | null;
  updated_at?: string | null;
}

export interface MaintenanceTicket {
  id?: string;
  title: string;
  description?: string | null;
  category: string;
  status: string;
  priority: string;
  location?: string | null;
  reported_by?: string | null;
  assigned_to?: string | null;
  resolution_notes?: string | null;
  due_date?: string | null;
  is_deleted?: boolean | null;
  created_at?: string | null;
  updated_at?: string | null;
}

export interface FirstAidLog {
  id?: string;
  incident_id?: string | null;
  person_involved_name: string;
  incident_date: string;
  person_type: string;
  injury_description?: string | null;
  treatment_provided: string;
  administered_by: string;
  referral_needed?: boolean | null;
  referral_details?: string | null;
  is_deleted?: boolean | null;
  created_at?: string | null;
  updated_at?: string | null;
}

export interface Incident {
  id?: string;
  title: string;
  incident_date: string;
  incident_type: string;
  severity: string;
  description: string;
  immediate_action_taken?: string | null;
  reported_by?: string | null;
  status?: string | null;
  resolution_notes?: string | null;
  is_deleted?: boolean | null;
  created_at?: string | null;
  updated_at?: string | null;
}

export interface InternalMovement {
  id?: string;
  animal_id?: string | null;
  movement_date: string;
  from_location?: string | null;
  to_location: string;
  reason?: string | null;
  notes?: string | null;
  is_deleted?: boolean | null;
  created_at?: string | null;
  updated_at?: string | null;
}

export interface ExternalTransfer {
  id?: string;
  animal_id?: string | null;
  transfer_type: string;
  transfer_date: string;
  entity_name: string;
  entity_contact?: string | null;
  reason?: string | null;
  notes?: string | null;
  is_deleted?: boolean | null;
  created_at?: string | null;
  updated_at?: string | null;
}

export interface OperationalList {
  id: string; // uuid
  category: string; // e.g., 'food_type', 'supplements', 'locations'
  name: string;
  animal_category: AnimalCategory | null;
  is_deleted: boolean;
  created_at?: string;
}

export interface RBACMatrix {
  id: string;
  role: string;
  capabilities: string[]; // e.g., ['husbandry:read', 'clinical:write']
  created_at?: string;
  updated_at?: string;
}

// ------------------------------------------------------------------
// LOGISTICS & VOUCHER TYPES (ADDED FROM SCHEMA)
// ------------------------------------------------------------------

export interface Voucher {
  id: string; // uuid
  transaction_id: string;
  voucher_code: string;
  experience_type: string;
  purchaser_name: string;
  purchaser_email: string;
  purchaser_mobile?: string | null;
  participants: number;
  guests: number;
  purchase_date?: string | null; // timestamp
  status: string;
  redeemed_at?: string | null; // timestamp
  redeemed_by?: string | null; // uuid
  expires_at?: string | null; // timestamp
  item_name?: string | null;
}

// ============================================================================
// ZONE 3: COMPONENT & JOIN TYPES (DASHBOARD VIEWS)
// ============================================================================

export interface FeedingScheduleWithAnimal extends FeedingSchedule {
  animals: Pick<Animal, 'id' | 'name' | 'species' | 'category' | 'profile_image_url'>;
}

export interface GroupedFeedingSchedule {
  animal_id: string;
  food_type: string | null;
  quantity: number | null;
  supplements: string | null;
  feed_not_required: boolean;
  start_date: string;
  end_date: string;
  count: number;
  child_ids: string[];
}

// ============================================================================
// ZONE 4: MUTATION PAYLOADS (WRITE LAYER)
// ============================================================================

export type AnimalPayload = Omit<Animal, 'id' | 'created_at' | 'updated_at'> & {
  id?: string; 
};

export interface CreateSchedulePayload {
  animal_id: string;
  scheduled_date: string;
  food_type: string | null;
  quantity: number | null;
  quantity_unit: string;
  status: ScheduleStatus;
  supplements: string | null;
  notes: string | null;
  is_deleted: boolean;
  created_by: string;
}