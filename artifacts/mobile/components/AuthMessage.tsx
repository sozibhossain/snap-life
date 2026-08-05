import { Feather } from "@expo/vector-icons";
import { StyleSheet, Text, View } from "react-native";

interface AuthMessageProps {
  message: string;
  color: string;
}

/** Full-width auth feedback that remains readable for long Clerk messages. */
export function AuthMessage({ message, color }: AuthMessageProps) {
  return (
    <View
      accessible
      accessibilityRole="alert"
      accessibilityLabel={message}
      accessibilityLiveRegion="polite"
      style={[
        styles.container,
        { backgroundColor: `${color}10`, borderColor: `${color}35` },
      ]}
    >
      <Feather
        name="alert-circle"
        size={16}
        color={color}
        style={styles.icon}
      />
      <Text
        style={[styles.message, { color }]}
        textBreakStrategy="simple"
        android_hyphenationFrequency="none"
      >
        {message}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: "100%",
    minWidth: 0,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 9,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  icon: { marginTop: 1 },
  message: {
    minWidth: 0,
    flex: 1,
    flexShrink: 1,
    fontSize: 13,
    lineHeight: 18,
    fontFamily: "Inter_400Regular",
    textAlign: "left",
  },
});
