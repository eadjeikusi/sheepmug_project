import { useState } from "react";
import { Image, Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import type { Group, GroupMemberPreviewFace } from "@sheepmug/shared-api";
import { displayMemberWords } from "../lib/memberDisplayFormat";
import { normalizeImageUri } from "../lib/imageUri";
import { type } from "../theme";
import { MemberInitialAvatar } from "./MemberInitialAvatar";

/** Vertical gap between list items (px). */
const LIST_GAP = 12;

/** Round avatar diameter (1:1 aspect, cover). */
const AVATAR = 32;
const AVATAR_OVERLAP = 8;

const CARD_PALETTES = [
  {
    cardBg: "#E8E2F8",
    shadow: "rgba(99, 102, 241, 0.22)",
  },
  {
    cardBg: "#D1EEF4",
    shadow: "rgba(14, 165, 233, 0.2)",
  },
  {
    cardBg: "#D9F2D0",
    shadow: "rgba(34, 197, 94, 0.2)",
  },
] as const;

type Props = {
  groups: Group[];
  onPressItem: (group: Group) => void;
  maxItems?: number;
};

function memberCount(g: Group): number | null {
  const n = g.member_count;
  return typeof n === "number" && Number.isFinite(n) ? n : null;
}

function memberPreview(g: Group): GroupMemberPreviewFace[] {
  const p = g.member_preview;
  const list = Array.isArray(p) ? p : [];
  return list.slice(0, 3);
}

/** Round image, fixed 1:1 — `resizeMode: cover` keeps aspect inside the circle. */
function RoundFace({
  imageUrl,
  initials,
  overlap,
}: {
  imageUrl: string | null;
  initials: string;
  overlap: boolean;
}) {
  const [failed, setFailed] = useState(false);
  const uri = normalizeImageUri(imageUrl);
  const showImg = Boolean(uri) && !failed;

  return (
    <View style={[styles.faceOuter, overlap && styles.faceOverlap]}>
      <View style={styles.faceClip}>
        {showImg ? (
          <Image
            source={{ uri: uri! }}
            style={styles.faceImage}
            resizeMode="cover"
            onError={() => setFailed(true)}
          />
        ) : (
          <MemberInitialAvatar
            initial={(initials || "?").slice(0, 1)}
            size={AVATAR}
            textStyle={styles.faceInitials}
          />
        )}
      </View>
    </View>
  );
}

function MemberFacesRow({ group }: { group: Group }) {
  const count = memberCount(group);
  const preview = memberPreview(group);
  const total = count ?? (preview.length > 0 ? preview.length : 0);
  const extraCount =
    count != null && count >= 0 ? Math.max(0, count - preview.length) : 0;

  return (
    <View style={styles.facesRow}>
      <View style={styles.facesLeft}>
        {preview.length > 0 ? (
          <View style={styles.faceStack}>
            {preview.map((p, i) => (
              <RoundFace
                key={p.member_id || `p-${i}`}
                imageUrl={p.image_url}
                initials={p.initials || "?"}
                overlap={i > 0}
              />
            ))}
            {extraCount > 0 ? (
              <View style={[styles.plusBadge, preview.length > 0 && styles.faceOverlap]}>
                <Text style={styles.plusBadgeText} numberOfLines={1}>
                  +{extraCount}
                </Text>
              </View>
            ) : null}
          </View>
        ) : total > 0 ? (
          <View style={styles.countOnly}>
            <Ionicons name="people-outline" size={18} color="#64748b" />
            <Text style={styles.countOnlyText}>{total}</Text>
          </View>
        ) : (
          <Text style={styles.noMembers}>No members yet</Text>
        )}
      </View>
    </View>
  );
}

export function MinistriesGrid({ groups, onPressItem, maxItems }: Props) {
  const list = typeof maxItems === "number" ? groups.slice(0, maxItems) : groups;

  return (
    <View style={styles.list}>
      {list.map((g, index) => {
        const rawDesc =
          typeof g.description === "string" && g.description.trim() ? g.description.trim() : null;
        const title = displayMemberWords(g.name || "");
        const desc = rawDesc ? displayMemberWords(rawDesc) : null;
        const palette = CARD_PALETTES[index % CARD_PALETTES.length];

        return (
          <Pressable
            key={g.id}
            style={({ pressed }) => [
              styles.card,
              {
                backgroundColor: palette.cardBg,
                shadowColor: palette.shadow,
              },
              pressed && styles.cardPressed,
            ]}
            onPress={() => onPressItem(g)}
          >
            <Text style={styles.cardTitle} numberOfLines={2}>
              {title}
            </Text>

            <Text style={styles.cardDesc} numberOfLines={4}>
              {desc || displayMemberWords("No description provided.")}
            </Text>

            <View style={styles.cardFooter}>
              <MemberFacesRow group={g} />
              <Ionicons name="chevron-forward" size={20} color="#94a3b8" />
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  list: {
    flexDirection: "column",
    gap: LIST_GAP,
    width: "100%",
  },
  card: {
    width: "100%",
    alignSelf: "stretch",
    borderRadius: 20,
    padding: 16,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.12,
    shadowRadius: 16,
    elevation: 4,
  },
  cardPressed: {
    opacity: 0.94,
    transform: [{ scale: 0.99 }],
  },
  cardTitle: {
    marginBottom: 8,
    fontSize: type.bodyStrong.size,
    lineHeight: type.bodyStrong.lineHeight,
    fontWeight: "700",
    color: "#0f172a",
    letterSpacing: type.bodyStrong.letterSpacing,
  },
  cardDesc: {
    fontSize: type.caption.size,
    lineHeight: 20,
    color: "#64748b",
    letterSpacing: type.caption.letterSpacing,
  },
  cardFooter: {
    marginTop: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  facesRow: {
    flex: 1,
    minWidth: 0,
  },
  facesLeft: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-start",
  },
  faceStack: {
    flexDirection: "row",
    alignItems: "center",
  },
  faceOuter: {
    width: AVATAR,
    height: AVATAR,
  },
  faceOverlap: {
    marginLeft: -AVATAR_OVERLAP,
  },
  /** 1:1 clipping — round; image uses cover inside. */
  faceClip: {
    width: AVATAR,
    height: AVATAR,
    borderRadius: AVATAR / 2,
    borderWidth: 2,
    borderColor: "#ffffff",
    overflow: "hidden",
    backgroundColor: "#e2e8f0",
  },
  faceImage: {
    width: "100%",
    height: "100%",
  },
  faceFallback: {
    width: "100%",
    height: "100%",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#e0e7ff",
  },
  faceInitials: {
    fontSize: 11,
    fontWeight: "700",
    color: "#4338ca",
  },
  plusBadge: {
    minWidth: AVATAR,
    height: AVATAR,
    borderRadius: AVATAR / 2,
    borderWidth: 2,
    borderColor: "#ffffff",
    backgroundColor: "#f1f5f9",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 6,
  },
  plusBadgeText: {
    fontSize: 12,
    fontWeight: "700",
    color: "#475569",
  },
  countOnly: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  countOnlyText: {
    fontSize: type.bodyStrong.size,
    fontWeight: "700",
    color: "#64748b",
  },
  noMembers: {
    fontSize: type.caption.size,
    color: "#94a3b8",
    fontStyle: "italic",
  },
});
