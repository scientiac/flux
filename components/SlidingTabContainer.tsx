import React, { useEffect } from 'react';
import { Dimensions, StyleSheet, View } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

const { width } = Dimensions.get('window');

interface SlidingTabContainerProps {
    children: React.ReactNode[];
    selectedIndex: number;
}

export const SlidingTabContainer = ({ children, selectedIndex }: SlidingTabContainerProps) => {
    const translateX = useSharedValue(0);
    const containerWidth = width; // Assuming full width for now, could be dynamic

    useEffect(() => {
        translateX.value = withTiming(-selectedIndex * containerWidth, {
            duration: 300,
            easing: Easing.bezier(0.25, 0.1, 0.25, 1),
        });
    }, [selectedIndex, containerWidth]);

    const animatedStyle = useAnimatedStyle(() => {
        return {
            transform: [{ translateX: translateX.value }],
        };
    });

    return (
        <View style={styles.container}>
            <Animated.View style={[styles.track, animatedStyle, { width: containerWidth * children.length }]}>
                {React.Children.map(children, (child, index) => (
                    <View key={index} style={{ width: containerWidth, height: '100%' }}>
                        {child}
                    </View>
                ))}
            </Animated.View>
        </View>
    );
};

const styles = StyleSheet.create({
    container: {
        flex: 1,
        overflow: 'hidden',
    },
    track: {
        flexDirection: 'row',
        flex: 1,
    },
});
