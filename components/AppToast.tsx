import React, { memo, useEffect } from 'react';
import { Image, Platform, StyleSheet, View } from 'react-native';
import { Portal, Surface, Text, useTheme } from 'react-native-paper';
import Animated, {
    Easing,
    runOnJS,
    useAnimatedStyle,
    useSharedValue,
    withDelay,
    withTiming
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

interface AppToastProps {
    visible: boolean;
    message: string;
    type?: 'success' | 'error' | 'info';
    onDismiss: () => void;
    duration?: number;
}

const AppToast = ({ visible, message, type = 'info', onDismiss, duration = 3000 }: AppToastProps) => {
    const theme = useTheme();
    const insets = useSafeAreaInsets();
    const translateY = useSharedValue(-100);
    const opacity = useSharedValue(0);

    // Using primaryContainer for more visibility while respecting Material You
    const backgroundColor = type === 'error' ? theme.colors.errorContainer : theme.colors.primaryContainer;
    const textColor = type === 'error' ? theme.colors.onErrorContainer : theme.colors.onPrimaryContainer;

    useEffect(() => {
        if (visible) {
            translateY.value = withTiming(insets.top + (Platform.OS === 'ios' ? 0 : 10), {
                duration: 500,
                easing: Easing.out(Easing.back(1.5))
            });
            opacity.value = withTiming(1, { duration: 400 });

            const timer = setTimeout(() => {
                hide();
            }, duration);

            return () => clearTimeout(timer);
        } else {
            hide(0);
        }
    }, [visible, insets.top]);

    const hide = (delay = 0) => {
        'worklet';
        translateY.value = withDelay(delay, withTiming(-100, {
            duration: 400,
            easing: Easing.in(Easing.back(1.5))
        }));
        opacity.value = withDelay(delay, withTiming(0, { duration: 300 }, () => {
            runOnJS(onDismiss)();
        }));
    };

    const animatedStyle = useAnimatedStyle(() => ({
        transform: [{ translateY: translateY.value }],
        opacity: opacity.value,
        display: (opacity.value === 0 && translateY.value === -100) ? 'none' : 'flex'
    }));

    return (
        <Portal>
            <Animated.View style={[styles.container, animatedStyle]}>
                <Surface elevation={3} style={[styles.surface, { backgroundColor }]}>
                    <View style={styles.content}>
                        <Image
                            source={require('../assets/images/icon.png')}
                            style={styles.icon}
                            resizeMode="contain"
                        />
                        <Text style={[styles.text, { color: textColor }]} variant="bodyMedium">
                            {message}
                        </Text>
                    </View>
                </Surface>
            </Animated.View>
        </Portal>
    );
};

const styles = StyleSheet.create({
    container: {
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        zIndex: 9999,
        alignItems: 'center',
        paddingHorizontal: 16,
    },
    surface: {
        borderRadius: 24,
        paddingHorizontal: 20,
        paddingVertical: 12,
        maxWidth: '95%',
        alignSelf: 'center',
        ...Platform.select({
            android: { elevation: 4 },
            ios: {
                shadowColor: '#000',
                shadowOffset: { width: 0, height: 4 },
                shadowOpacity: 0.1,
                shadowRadius: 8,
            }
        })
    },
    content: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
    },
    icon: {
        width: 20,
        height: 20,
        borderRadius: 6,
        marginRight: 10,
    },
    text: {
        fontWeight: '600',
        textAlign: 'center',
    }
});

export default memo(AppToast);
