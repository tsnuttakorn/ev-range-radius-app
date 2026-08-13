import React, { useRef, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { FontAwesome } from '@expo/vector-icons';
import { searchLocations } from '../utils/RouteService';
import { useEVStore } from '../store/useEVStore';
import { RecentSearchItem } from '../types/ev';
import { Theme, radius, spacing } from '../theme/tokens';

export interface LocationSearchFieldProps {
  value: string;
  placeholder: string;
  onChangeText: (text: string) => void;
  onSelect: (result: any) => void;
  theme: Theme;
  /** FontAwesome icon shown on the trigger row. */
  icon?: string;
  /** "large" for the primary destination search, "compact" for the secondary start row. */
  size?: 'large' | 'compact';
  /** Extra hint text shown under the search box when there's nothing typed yet and no recent searches. */
  emptyHint?: string;
}

/**
 * A search field that opens a full-screen search experience (à la Google Maps) instead of a
 * dropdown anchored under a small input. A previous version tried to position a floating
 * dropdown under the input using `measureInWindow`, which is fragile — any mismatch between the
 * measured coordinates and the modal's own coordinate space (status bar insets, timing) could
 * land the results list on top of the input instead of below it. Going full-screen removes that
 * whole class of bug: there's no position to get wrong.
 *
 * Recently-selected places (shared across every field, in the global store) are shown before
 * you've typed anything, so a place you've searched before — as either a start or a destination
 * — is one tap away instead of a full retype.
 */
export const LocationSearchField: React.FC<LocationSearchFieldProps> = ({
  value,
  placeholder,
  onChangeText,
  onSelect,
  theme: t,
  icon = 'search',
  size = 'compact',
  emptyHint,
}) => {
  const { recentSearches, addRecentSearch, removeRecentSearch, clearRecentSearches } = useEVStore();

  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState(value);
  const [results, setResults] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);

  const debounceRef = useRef<any>(null);
  const inputRef = useRef<TextInput>(null);

  const openSearch = () => {
    setQuery(value);
    setResults([]);
    setSearched(false);
    setIsOpen(true);
    // Focus after the modal has actually mounted, not before.
    setTimeout(() => inputRef.current?.focus(), Platform.OS === 'ios' ? 200 : 100);
  };

  const closeSearch = () => {
    setIsOpen(false);
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
  };

  const runSearch = async (text: string) => {
    setLoading(true);
    const found = await searchLocations(text);
    setResults(found);
    setSearched(true);
    setLoading(false);
  };

  const handleChangeText = (text: string) => {
    setQuery(text);
    setSearched(false);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (text.trim().length < 2) {
      setResults([]);
      return;
    }
    debounceRef.current = setTimeout(() => runSearch(text), 500);
  };

  const handleSubmit = () => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (query.trim().length >= 2) runSearch(query);
  };

  const handleSelect = (item: any) => {
    onChangeText(item.display_name.split(',')[0]);
    onSelect(item);
    addRecentSearch({
      id: String(item.place_id ?? `${item.lat}_${item.lon}`),
      display_name: item.display_name,
      lat: String(item.lat),
      lon: String(item.lon),
    });
    closeSearch();
  };

  const isLarge = size === 'large';
  const showRecent = query.trim().length === 0 && recentSearches.length > 0;

  return (
    <>
      <TouchableOpacity
        style={[
          styles.trigger,
          isLarge ? styles.triggerLarge : styles.triggerCompact,
          { backgroundColor: t.surfaceSunken, borderColor: t.borderSubtle },
        ]}
        onPress={openSearch}
        activeOpacity={0.7}
      >
        <FontAwesome name={icon as any} size={isLarge ? 15 : 12} color={value ? t.brand : t.textTertiary} />
        <Text
          style={[
            isLarge ? styles.triggerTextLarge : styles.triggerTextCompact,
            { color: value ? t.textPrimary : t.textTertiary, marginLeft: isLarge ? 10 : 8 },
          ]}
          numberOfLines={1}
        >
          {value || placeholder}
        </Text>
      </TouchableOpacity>

      <Modal visible={isOpen} animationType="slide" onRequestClose={closeSearch}>
        <View style={[styles.screen, { backgroundColor: t.bg }]}>
          <View style={[styles.searchHeader, { borderBottomColor: t.borderSubtle }]}>
            <TouchableOpacity onPress={closeSearch} style={styles.backButton} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <FontAwesome name="arrow-left" size={16} color={t.textPrimary} />
            </TouchableOpacity>
            <View style={[styles.searchInputWrap, { backgroundColor: t.surfaceSunken, borderColor: t.borderSubtle }]}>
              <TextInput
                ref={inputRef}
                style={[styles.searchInput, { color: t.textPrimary }]}
                placeholder={placeholder}
                placeholderTextColor={t.textTertiary}
                value={query}
                onChangeText={handleChangeText}
                onSubmitEditing={handleSubmit}
                returnKeyType="search"
              />
              {query.length > 0 && (
                <TouchableOpacity onPress={() => handleChangeText('')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                  <FontAwesome name="times-circle" size={15} color={t.textTertiary} />
                </TouchableOpacity>
              )}
            </View>
          </View>

          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.resultsScroll}>
            {showRecent && (
              <>
                <View style={styles.sectionHeaderRow}>
                  <Text style={[styles.sectionHeaderText, { color: t.textTertiary }]}>RECENT</Text>
                  <TouchableOpacity onPress={clearRecentSearches} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                    <Text style={[styles.clearAllText, { color: t.textTertiary }]}>Clear</Text>
                  </TouchableOpacity>
                </View>
                {recentSearches.map((item: RecentSearchItem) => (
                  <View key={item.id} style={[styles.resultItem, { borderBottomColor: t.borderSubtle }]}>
                    <TouchableOpacity style={styles.recentItemPress} onPress={() => handleSelect(item)} activeOpacity={0.7}>
                      <View style={[styles.resultIconWrap, { backgroundColor: t.surfaceRaised }]}>
                        <FontAwesome name="history" size={13} color={t.textTertiary} />
                      </View>
                      <Text style={[styles.resultText, { color: t.textPrimary }]} numberOfLines={2}>
                        {item.display_name}
                      </Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      onPress={() => removeRecentSearch(item.id)}
                      hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                      style={styles.removeRecentButton}
                    >
                      <FontAwesome name="close" size={13} color={t.textTertiary} />
                    </TouchableOpacity>
                  </View>
                ))}
              </>
            )}

            {loading && (
              <View style={styles.statusRow}>
                <ActivityIndicator size="small" color={t.brand} />
                <Text style={[styles.statusText, { color: t.textSecondary }]}>Searching…</Text>
              </View>
            )}

            {!loading && searched && results.length === 0 && (
              <View style={styles.statusRow}>
                <FontAwesome name="frown-o" size={14} color={t.textTertiary} />
                <Text style={[styles.statusText, { color: t.textTertiary }]}>
                  No matches found — try a different spelling.
                </Text>
              </View>
            )}

            {!loading && !searched && results.length === 0 && !showRecent && emptyHint && (
              <View style={styles.statusRow}>
                <FontAwesome name="info-circle" size={14} color={t.textTertiary} />
                <Text style={[styles.statusText, { color: t.textTertiary }]}>{emptyHint}</Text>
              </View>
            )}

            {!loading &&
              results.map((item, index) => (
                <TouchableOpacity
                  key={`${item.place_id ?? index}`}
                  style={[styles.resultItem, { borderBottomColor: t.borderSubtle }]}
                  onPress={() => handleSelect(item)}
                  activeOpacity={0.7}
                >
                  <View style={[styles.resultIconWrap, { backgroundColor: t.surfaceRaised }]}>
                    <FontAwesome name="map-marker" size={14} color={t.textTertiary} />
                  </View>
                  <Text style={[styles.resultText, { color: t.textPrimary }]} numberOfLines={2}>
                    {item.display_name}
                  </Text>
                </TouchableOpacity>
              ))}
          </ScrollView>
        </View>
      </Modal>
    </>
  );
};

const styles = StyleSheet.create({
  trigger: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
  },
  triggerLarge: {
    borderRadius: radius.card,
    paddingVertical: 14,
    paddingHorizontal: 16,
  },
  triggerCompact: {
    borderRadius: radius.md,
    paddingVertical: 9,
    paddingHorizontal: 12,
  },
  triggerTextLarge: {
    fontSize: 14,
    fontWeight: '600',
    flex: 1,
  },
  triggerTextCompact: {
    fontSize: 12,
    fontWeight: '500',
    flex: 1,
  },
  screen: {
    flex: 1,
  },
  searchHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingTop: Platform.OS === 'ios' ? 60 : 24,
    paddingBottom: 14,
    borderBottomWidth: 1,
  },
  backButton: {
    padding: 4,
  },
  searchInputWrap: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    height: 42,
    borderRadius: radius.md,
    borderWidth: 1,
    paddingHorizontal: 14,
    gap: 8,
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
    height: '100%',
  },
  resultsScroll: {
    paddingVertical: 8,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 6,
  },
  sectionHeaderText: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1.2,
  },
  clearAllText: {
    fontSize: 11,
    fontWeight: '700',
  },
  resultItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
  },
  recentItemPress: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
  },
  removeRecentButton: {
    paddingLeft: 12,
  },
  resultIconWrap: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  resultText: {
    fontSize: 13,
    fontWeight: '500',
    flex: 1,
    lineHeight: 18,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 20,
    paddingHorizontal: 16,
    gap: 10,
  },
  statusText: {
    fontSize: 13,
    fontWeight: '500',
    flex: 1,
  },
});
