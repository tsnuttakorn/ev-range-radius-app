import React, { useRef, useState } from 'react';
import {
  StyleSheet,
  View,
  Text,
  TouchableOpacity,
  TextInput,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  Alert,
} from 'react-native';
import { FontAwesome } from '@expo/vector-icons';
import { useShallow } from 'zustand/react/shallow';
import { useEVStore } from '../store/useEVStore';
import { UserEVProfile, RatingStandard } from '../types/ev';
import { getTheme, radius } from '../theme/tokens';
import { useResolvedThemeMode } from '../theme/useResolvedThemeMode';
import { PRESET_VEHICLES } from '../constants/presetVehicles';

interface VehicleSelectModalProps {
  onClose: () => void;
}

export const VehicleSelectModal: React.FC<VehicleSelectModalProps> = ({ onClose }) => {
  const { savedVehicles, activeVehicle, setActiveVehicle, addCustomVehicle, updateVehicle, deleteVehicle } =
    useEVStore(
      useShallow((state) => ({
        savedVehicles: state.savedVehicles,
        activeVehicle: state.activeVehicle,
        setActiveVehicle: state.setActiveVehicle,
        addCustomVehicle: state.addCustomVehicle,
        updateVehicle: state.updateVehicle,
        deleteVehicle: state.deleteVehicle,
      }))
    );
  const themeMode = useResolvedThemeMode();
  const t = getTheme(themeMode);
  const scrollRef = useRef<ScrollView>(null);

  // Custom EV Form State — doubles as the "edit vehicle" form when editingVehicleId is set.
  const [editingVehicleId, setEditingVehicleId] = useState<string | null>(null);
  const [customName, setCustomName] = useState('');
  const [customCapacity, setCustomCapacity] = useState('');
  const [customRange, setCustomRange] = useState('');
  const [customStandard, setCustomStandard] = useState<RatingStandard>('WLTP');
  const [customMaxDcKW, setCustomMaxDcKW] = useState('');
  const [customMaxAcKW, setCustomMaxAcKW] = useState('');

  const isEditing = editingVehicleId !== null;

  const resetForm = () => {
    setEditingVehicleId(null);
    setCustomName('');
    setCustomCapacity('');
    setCustomRange('');
    setCustomMaxDcKW('');
    setCustomMaxAcKW('');
  };

  const handleSelectVehicle = (vehicle: UserEVProfile) => {
    setActiveVehicle(vehicle);
    onClose();
  };

  const handleStartEdit = (vehicle: UserEVProfile) => {
    setEditingVehicleId(vehicle.id);
    setCustomName(vehicle.modelName);
    setCustomCapacity(String(vehicle.batteryCapacityKWh));
    setCustomRange(String(vehicle.officialRangeKm));
    setCustomStandard(vehicle.ratingStandard === 'CUSTOM' ? 'WLTP' : vehicle.ratingStandard);
    setCustomMaxDcKW(String(vehicle.maxDcChargeKW));
    setCustomMaxAcKW(String(vehicle.maxAcChargeKW));
    // The form sits below the list — scroll down so the edit is visible right away.
    requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated: true }));
  };

  const handleDeleteVehicle = (vehicle: UserEVProfile) => {
    if (savedVehicles.length <= 1) {
      Alert.alert('Cannot Delete', 'You need at least one vehicle in your garage.');
      return;
    }
    Alert.alert('Delete Vehicle', `Remove "${vehicle.modelName}" from your garage?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          deleteVehicle(vehicle.id);
          if (editingVehicleId === vehicle.id) resetForm();
        },
      },
    ]);
  };

  const handleSaveVehicle = () => {
    // 1. Validation
    const name = customName.trim();
    const capacity = parseFloat(customCapacity);
    const range = parseFloat(customRange);
    const maxDcKW = parseFloat(customMaxDcKW);
    const maxAcKW = parseFloat(customMaxAcKW);

    if (!name) {
      Alert.alert('Validation Error', 'Please enter a vehicle model name.');
      return;
    }
    if (isNaN(capacity) || capacity <= 0) {
      Alert.alert('Validation Error', 'Please enter a valid battery capacity greater than 0 kWh.');
      return;
    }
    if (isNaN(range) || range <= 0) {
      Alert.alert('Validation Error', 'Please enter a valid range greater than 0 km.');
      return;
    }
    if (isNaN(maxDcKW) || maxDcKW <= 0) {
      Alert.alert('Validation Error', 'Please enter a valid max DC fast-charge speed greater than 0 kW.');
      return;
    }
    if (isNaN(maxAcKW) || maxAcKW <= 0) {
      Alert.alert('Validation Error', 'Please enter a valid max AC charge speed greater than 0 kW.');
      return;
    }

    const profile: UserEVProfile = {
      id: editingVehicleId ?? `custom-${Date.now()}`,
      modelName: name,
      batteryCapacityKWh: capacity,
      officialRangeKm: range,
      ratingStandard: customStandard,
      customEfficiencyFactor: 1.0,
      maxDcChargeKW: maxDcKW,
      maxAcChargeKW: maxAcKW,
    };

    if (isEditing) {
      updateVehicle(profile);
    } else {
      addCustomVehicle(profile);
      setActiveVehicle(profile);
    }

    resetForm();
    onClose();
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={[styles.modalOverlay, { backgroundColor: t.bg }]}
    >
      <View style={[styles.modalContent, { backgroundColor: t.bg }]}>
        {/* Header */}
        <View style={[styles.header, { borderBottomColor: t.borderSubtle }]}>
          <View>
            <Text style={[styles.headerEyebrow, { color: t.brand }]}>GARAGE</Text>
            <Text style={[styles.headerTitle, { color: t.textPrimary }]}>Select Vehicle</Text>
          </View>
          <TouchableOpacity onPress={onClose} style={[styles.closeButton, { backgroundColor: t.surface }]}>
            <FontAwesome name="close" size={16} color={t.textSecondary} />
          </TouchableOpacity>
        </View>

        <ScrollView ref={scrollRef} contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
          {/* Preset list header */}
          <Text style={[styles.sectionTitle, { color: t.textTertiary }]}>Saved &amp; Preset Vehicles</Text>

          <View style={styles.listContainer}>
            {savedVehicles.map((vehicle) => {
              const isActive = activeVehicle.id === vehicle.id;
              const isBeingEdited = editingVehicleId === vehicle.id;
              const isPreset = PRESET_VEHICLES.some((pv) => pv.id === vehicle.id);
              const presetInfo = PRESET_VEHICLES.find((pv) => pv.id === vehicle.id);
              const maxDc = vehicle.maxDcChargeKW ?? presetInfo?.maxDcChargeKW ?? 50;
              const maxAc = vehicle.maxAcChargeKW ?? presetInfo?.maxAcChargeKW ?? 7;
              return (
                <View
                  key={vehicle.id}
                  style={[
                    styles.vehicleCard,
                    { backgroundColor: t.surface, borderColor: t.borderSubtle },
                    isActive && { borderColor: t.brand, backgroundColor: t.brandDim },
                    isBeingEdited && { borderColor: t.reserve },
                  ]}
                >
                  <TouchableOpacity
                    style={styles.vehicleInfo}
                    onPress={() => handleSelectVehicle(vehicle)}
                    activeOpacity={0.85}
                  >
                    <View style={[styles.brandIconWrap, { backgroundColor: isActive ? t.brandDim : t.surfaceRaised }]}>
                      <FontAwesome name="bolt" size={16} color={isActive ? t.brand : t.textTertiary} />
                    </View>
                    <View style={{ flexShrink: 1 }}>
                      <Text style={[styles.vehicleModelName, { color: t.textPrimary }]} numberOfLines={1}>
                        {vehicle.modelName}
                      </Text>
                      <Text style={[styles.vehicleSpecText, { color: t.textTertiary }]}>
                        {vehicle.batteryCapacityKWh} kWh · {vehicle.officialRangeKm} km · {vehicle.ratingStandard}
                      </Text>
                      <Text style={[styles.vehicleSpecText, { color: t.textTertiary }]}>
                        Up to {maxDc} kW DC · {maxAc} kW AC
                      </Text>
                    </View>
                  </TouchableOpacity>

                  <View style={styles.vehicleActions}>
                    {isActive && (
                      <View style={[styles.activeCheckCircle, { backgroundColor: t.brand }]}>
                        <FontAwesome name="check" size={11} color="#ffffff" />
                      </View>
                    )}
                    {!isPreset && (
                      <>
                        <TouchableOpacity
                          style={[styles.iconActionButton, { backgroundColor: t.surfaceRaised }]}
                          onPress={() => handleStartEdit(vehicle)}
                          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                        >
                          <FontAwesome name="pencil" size={12} color={t.textSecondary} />
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={[styles.iconActionButton, { backgroundColor: t.surfaceRaised }]}
                          onPress={() => handleDeleteVehicle(vehicle)}
                          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                        >
                          <FontAwesome name="trash-o" size={12} color={t.danger} />
                        </TouchableOpacity>
                      </>
                    )}
                  </View>
                </View>
              );
            })}
          </View>

          {/* Form: Add Custom EV / Edit Vehicle */}
          <View
            style={[
              styles.formContainer,
              { backgroundColor: t.surface, borderColor: isEditing ? t.reserve : t.borderSubtle },
            ]}
          >
            <View style={styles.formHeaderRow}>
              <View style={[styles.iconChip, { backgroundColor: isEditing ? t.reserveDim : t.brandDim }]}>
                <FontAwesome name={isEditing ? 'pencil' : 'plus'} size={12} color={isEditing ? t.reserve : t.brand} />
              </View>
              <Text style={[styles.sectionTitle, { color: t.textTertiary, marginBottom: 0, flex: 1 }]}>
                {isEditing ? 'Edit Vehicle' : 'Add Custom EV'}
              </Text>
              {isEditing && (
                <TouchableOpacity onPress={resetForm}>
                  <Text style={[styles.cancelEditText, { color: t.textTertiary }]}>Cancel</Text>
                </TouchableOpacity>
              )}
            </View>

            <Text style={[styles.label, { color: t.textTertiary }]}>Vehicle Model Name</Text>
            <TextInput
              style={[styles.input, { backgroundColor: t.surfaceSunken, color: t.textPrimary, borderColor: t.borderSubtle }]}
              placeholder="e.g., Porsche Taycan 4S"
              placeholderTextColor={t.textTertiary}
              value={customName}
              onChangeText={setCustomName}
            />

            <View style={styles.row}>
              <View style={styles.flexHalf}>
                <Text style={[styles.label, { color: t.textTertiary }]}>Battery Capacity (kWh)</Text>
                <TextInput
                  style={[styles.input, { backgroundColor: t.surfaceSunken, color: t.textPrimary, borderColor: t.borderSubtle }]}
                  placeholder="e.g., 93.4"
                  placeholderTextColor={t.textTertiary}
                  keyboardType="numeric"
                  value={customCapacity}
                  onChangeText={setCustomCapacity}
                />
              </View>
              <View style={[styles.flexHalf, { marginLeft: 12 }]}>
                <Text style={[styles.label, { color: t.textTertiary }]}>Official Range (km)</Text>
                <TextInput
                  style={[styles.input, { backgroundColor: t.surfaceSunken, color: t.textPrimary, borderColor: t.borderSubtle }]}
                  placeholder="e.g., 463"
                  placeholderTextColor={t.textTertiary}
                  keyboardType="numeric"
                  value={customRange}
                  onChangeText={setCustomRange}
                />
              </View>
            </View>

            <View style={styles.row}>
              <View style={styles.flexHalf}>
                <Text style={[styles.label, { color: t.textTertiary }]}>Max DC Fast Charge (kW)</Text>
                <TextInput
                  style={[styles.input, { backgroundColor: t.surfaceSunken, color: t.textPrimary, borderColor: t.borderSubtle }]}
                  placeholder="e.g., 130"
                  placeholderTextColor={t.textTertiary}
                  keyboardType="numeric"
                  value={customMaxDcKW}
                  onChangeText={setCustomMaxDcKW}
                />
              </View>
              <View style={[styles.flexHalf, { marginLeft: 12 }]}>
                <Text style={[styles.label, { color: t.textTertiary }]}>Max AC Charge (kW)</Text>
                <TextInput
                  style={[styles.input, { backgroundColor: t.surfaceSunken, color: t.textPrimary, borderColor: t.borderSubtle }]}
                  placeholder="e.g., 6.6"
                  placeholderTextColor={t.textTertiary}
                  keyboardType="numeric"
                  value={customMaxAcKW}
                  onChangeText={setCustomMaxAcKW}
                />
              </View>
            </View>

            <Text style={[styles.label, { color: t.textTertiary }]}>Rating Standard</Text>
            <View style={[styles.segmentedContainer, { backgroundColor: t.surfaceSunken }]}>
              {(['NEDC', 'WLTP', 'EPA'] as RatingStandard[]).map((std) => (
                <TouchableOpacity
                  key={std}
                  style={[
                    styles.segmentButton,
                    customStandard === std && { backgroundColor: t.brand },
                  ]}
                  onPress={() => setCustomStandard(std)}
                >
                  <Text
                    style={[
                      styles.segmentText,
                      { color: customStandard === std ? '#ffffff' : t.textTertiary },
                    ]}
                  >
                    {std}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <TouchableOpacity
              style={[styles.saveButton, { backgroundColor: isEditing ? t.reserve : t.brand }]}
              onPress={handleSaveVehicle}
              activeOpacity={0.9}
            >
              <FontAwesome name={isEditing ? 'check' : 'plus-circle'} size={14} color="#ffffff" />
              <Text style={styles.saveButtonText}>{isEditing ? 'Save Changes' : 'Add & Select Vehicle'}</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </View>
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  modalOverlay: {
    flex: 1,
  },
  modalContent: {
    flex: 1,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingTop: Platform.OS === 'ios' ? 64 : 28,
    paddingBottom: 20,
    borderBottomWidth: 1,
  },
  headerEyebrow: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.6,
    marginBottom: 2,
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: '800',
    letterSpacing: -0.5,
  },
  closeButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scrollContent: {
    padding: 20,
    paddingBottom: 40,
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 1.4,
    marginBottom: 12,
  },
  listContainer: {
    marginBottom: 28,
    gap: 10,
  },
  vehicleCard: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 14,
    borderRadius: 18,
    borderWidth: 1.5,
  },
  vehicleInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    flexShrink: 1,
    flex: 1,
  },
  vehicleActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginLeft: 8,
  },
  iconActionButton: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  brandIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 14,
  },
  vehicleModelName: {
    fontSize: 15,
    fontWeight: '700',
  },
  vehicleSpecText: {
    fontSize: 12,
    marginTop: 3,
    fontWeight: '500',
  },
  activeCheckCircle: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  formContainer: {
    borderRadius: radius.card,
    padding: 20,
    borderWidth: 1,
  },
  formHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 4,
  },
  cancelEditText: {
    fontSize: 12,
    fontWeight: '700',
  },
  iconChip: {
    width: 24,
    height: 24,
    borderRadius: 7,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: {
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 8,
    marginTop: 14,
  },
  input: {
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 14,
    fontSize: 14,
    borderWidth: 1,
  },
  row: {
    flexDirection: 'row',
  },
  flexHalf: {
    flex: 1,
  },
  segmentedContainer: {
    flexDirection: 'row',
    borderRadius: 10,
    padding: 4,
    marginTop: 4,
    marginBottom: 18,
  },
  segmentButton: {
    flex: 1,
    paddingVertical: 9,
    alignItems: 'center',
    borderRadius: 8,
  },
  segmentText: {
    fontWeight: '700',
    fontSize: 12,
  },
  saveButton: {
    flexDirection: 'row',
    gap: 8,
    borderRadius: 14,
    paddingVertical: 15,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 6,
  },
  saveButtonText: {
    color: '#ffffff',
    fontWeight: '700',
    fontSize: 14,
  },
});
